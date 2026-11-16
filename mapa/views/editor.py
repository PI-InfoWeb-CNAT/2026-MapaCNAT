from functools import wraps
from collections import defaultdict
from typing import Any
import json

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpResponse, JsonResponse, Http404
from django.shortcuts import get_object_or_404
from django.template import loader
from django.urls import reverse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from ..models import *

@login_required
def mapa_editor(request: Any, mapa_id):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render(), status=404)

    mapa = get_object_or_404(Mapa, pk=mapa_id)
    context = {
        "mapa": mapa
    }
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render(context=context, request=request))


@login_required
@ensure_csrf_cookie
@require_POST
def mapa_editor_data(request: Any, mapa_id):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render(), status=404)
    
    mapa = get_object_or_404(Mapa, pk=mapa_id)

    try:
        raw_data = request.POST.get('data')
        if raw_data:
            data = json.loads(raw_data)
        else:
            data = json.loads(request.body)

        with transaction.atomic():
            # Lock the map row: two simultaneous saves of the same map are serialized.
            Mapa.objects.select_for_update().get(pk=mapa.pk)

            # Only this map's data is cleared (same order as before).
            Rota.objects.filter(mapa=mapa).delete()
            Referencia.objects.filter(mapa=mapa).delete()
            ConstrucaoRegiao.objects.filter(mapa=mapa).delete()
            Construcao.objects.filter(mapa=mapa).delete()
            Banner.objects.filter(mapa=mapa).delete()

            ref_db_map = {}
            build_db_map = {}

            buildings_data = data.get("buildings", {})
            references_data = data.get("references", {})
            banners_data = data.get("banners", {})
            areas_catalog = data.get("areas", {})
            connections_data = data.get("connections", {})

            ref_to_build_id = {}
            for b_id, b_info in buildings_data.items():
                for entrance_ref_id in b_info.get("entrances", []):
                    ref_to_build_id[str(entrance_ref_id)] = str(b_id)

            for b_id, b_info in buildings_data.items():
                construcao = Construcao.objects.create(
                    mapa=mapa,
                    nome=b_info.get("name", ""),
                    localizacao_pino=b_info.get("pin", {"x": 0, "y": 0}),
                )
                build_db_map[str(b_id)] = construcao

                for area_id in b_info.get("areas", []):
                    area_info = areas_catalog.get(str(area_id), {})
                    if area_info:
                        ConstrucaoRegiao.objects.create(
                            mapa=mapa,
                            min=area_info.get("min"),
                            max=area_info.get("max"),
                            construcao=construcao,
                        )

            for ref_id, ref_info in references_data.items():
                linked_build_id = ref_to_build_id.get(str(ref_id))
                linked_build = build_db_map.get(linked_build_id) if linked_build_id else None

                ref_obj = Referencia.objects.create(
                    mapa=mapa,
                    localizacao=ref_info.get("pos"),
                    construcao=linked_build,
                )
                ref_db_map[str(ref_id)] = ref_obj

            for banner_id, banner_info in banners_data.items():
                title = banner_info.get("title", "")
                description = banner_info.get("description", "")
                name_alias = banner_info.get("alias", [])
                uploaded_file = request.FILES.get(f"file_{banner_id}")

                if uploaded_file is None and not title and not description:
                    continue

                image_bytes = None
                mime_type = None
                if uploaded_file:
                    image_bytes = uploaded_file.read()
                    mime_type = uploaded_file.content_type or 'image/png'

                linked_build = None
                linked_ref = None

                for b_id, b_info in buildings_data.items():
                    if b_info.get("banner") is not None and str(b_info.get("banner")) == str(banner_id):
                        linked_build = build_db_map.get(str(b_id))
                        break

                if not linked_build:
                    for ref_id, ref_info in references_data.items():
                        if ref_info.get("banner") is not None and str(ref_info.get("banner")) == str(banner_id):
                            linked_ref = ref_db_map.get(str(ref_id))
                            break

                Banner.objects.create(
                    mapa=mapa,
                    titulo=title,
                    descricao=description,
                    name_alias=name_alias,
                    imagem_blob=image_bytes,
                    imagem_mime_type=mime_type,
                    construcao=linked_build,
                    referencia=linked_ref,
                )

            conn_items = connections_data.values() if isinstance(connections_data, dict) else connections_data
            for conn in conn_items:
                start_ref = ref_db_map.get(str(conn.get("a")))
                end_ref = ref_db_map.get(str(conn.get("b")))

                if start_ref and end_ref:
                    Rota.objects.create(
                        mapa=mapa,
                        local_inicio=start_ref,
                        local_fim=end_ref,
                    )

        return JsonResponse({"status": "success"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


@ensure_csrf_cookie
@require_GET
def mapa_data_load(request: Any, mapa_id):
    mapa = get_object_or_404(Mapa, pk=mapa_id)
    return JsonResponse(export_db_to_json(mapa, request=request), status=200)

def get_banner_image(request, banner_id):
    banner = get_object_or_404(Banner, pk=banner_id)
    if not banner.imagem_blob:
        raise Http404("Image does not exist")

    return HttpResponse(
        banner.imagem_blob,
        content_type=banner.imagem_mime_type or 'image/png'
    )


def export_db_to_json(mapa, request=None):
    banners_dict = {}
    build_banner_map = {}
    ref_banner_map = {}

    # defer(): do not pull every image blob into memory just to build the JSON.
    # The mime type is only ever set together with a blob, so it tells us if an image exists.
    for banner in Banner.objects.filter(mapa=mapa).defer("imagem_blob"):
        banner_id_str = str(banner.id)

        if banner.imagem_mime_type:
            image_url = reverse('banner_image', args=[banner.id])
            if request:
                image_url = request.build_absolute_uri(image_url)
        else:
            image_url = ""

        banners_dict[banner_id_str] = {
            "image": image_url,
            "title": banner.titulo or "",
            "description": banner.descricao or "",
            "alias": banner.name_alias or []
        }

        if banner.construcao_id is not None:
            build_banner_map[banner.construcao_id] = banner.id
        if banner.referencia_id is not None:
            ref_banner_map[banner.referencia_id] = banner.id

    areas_dict = {}
    build_areas_map = defaultdict(list)
    for area in ConstrucaoRegiao.objects.filter(mapa=mapa):
        areas_dict[str(area.id)] = {
            "min": area.min,
            "max": area.max
        }
        if area.construcao_id is not None:
            build_areas_map[area.construcao_id].append(area.id)

    references_dict = {}
    build_entrances_map = defaultdict(list)
    for ref in Referencia.objects.filter(mapa=mapa):
        references_dict[str(ref.id)] = {
            "pos": ref.localizacao,
            "banner": ref_banner_map.get(ref.id)
        }
        if ref.construcao_id is not None:
            build_entrances_map[ref.construcao_id].append(ref.id)

    buildings_dict = {}
    for build in Construcao.objects.filter(mapa=mapa):
        buildings_dict[str(build.id)] = {
            "name": build.nome or "",
            "pin": build.localizacao_pino,
            "areas": build_areas_map.get(build.id, []),
            "entrances": build_entrances_map.get(build.id, []),
            "banner": build_banner_map.get(build.id)
        }

    connections_dict = {}
    for route in Rota.objects.filter(mapa=mapa):
        start_id = route.local_inicio_id
        end_id = route.local_fim_id
        if start_id is not None and end_id is not None:
            connections_dict[f"{start_id},{end_id}"] = {
                "a": start_id,
                "b": end_id
            }

    return {
        "buildings": buildings_dict,
        "references": references_dict,
        "banners": banners_dict,
        "areas": areas_dict,
        "connections": connections_dict,
        "files": {}
    }
