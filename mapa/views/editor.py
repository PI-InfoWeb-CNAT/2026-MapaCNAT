from django.views.decorators.csrf import ensure_csrf_cookie
from django.shortcuts import get_object_or_404
from django.http import HttpResponse, JsonResponse, Http404
from django.db import transaction
from django.template import loader
from django.urls import reverse
from typing import Any
import json
from collections import defaultdict
from ..models import *
from django.contrib.auth.decorators import login_required
import os
import shutil
from django.conf import settings

@login_required
def mapa_editor(request: Any):
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render())

@login_required
@ensure_csrf_cookie
def mapa_editor_data(request: Any):
    if request.method == 'POST':
        try:
            raw_data = request.POST.get('data')
            if raw_data:
                data = json.loads(raw_data)
            else:
                data = json.loads(request.body)

            with transaction.atomic():
                Rota.objects.all().delete()
                Referencia.objects.all().delete()
                ConstrucaoRegiao.objects.all().delete()
                Construcao.objects.all().delete()
                Banner.objects.all().delete()

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
                        nome=b_info.get("name", ""),
                        localizacao_pino=b_info.get("pin", {"x": 0, "y": 0}),
                    )
                    build_db_map[str(b_id)] = construcao

                    area_ids = b_info.get("areas", [])
                    for area_id in area_ids:
                        area_info = areas_catalog.get(str(area_id), {})
                        if area_info:
                            ConstrucaoRegiao.objects.create(
                                min=area_info.get("min"),
                                max=area_info.get("max"),
                                construcao=construcao
                            )

                for ref_id, ref_info in references_data.items():
                    linked_build_id = ref_to_build_id.get(str(ref_id))
                    linked_build = build_db_map.get(linked_build_id) if linked_build_id else None

                    ref_obj = Referencia.objects.create(
                        localizacao=ref_info.get("pos"),
                        construcao=linked_build
                    )
                    ref_db_map[str(ref_id)] = ref_obj

                for banner_id, banner_info in banners_data.items():
                    title = banner_info.get("title", "")
                    description = banner_info.get("description", "")
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
                        titulo=title,
                        descricao=description,
                        imagem_blob=image_bytes,
                        imagem_mime_type=mime_type,
                        construcao=linked_build,
                        referencia=linked_ref
                    )

                conn_items = connections_data.values() if isinstance(connections_data, dict) else connections_data
                for conn in conn_items:
                    start_ref_id = str(conn.get("a"))
                    end_ref_id = str(conn.get("b"))

                    start_ref = ref_db_map.get(start_ref_id)
                    end_ref = ref_db_map.get(end_ref_id)

                    if start_ref and end_ref:
                        Rota.objects.create(
                            local_inicio=start_ref,
                            local_fim=end_ref
                        )

            return JsonResponse({"status": "success"})
        except Exception as e:
            return JsonResponse({"status": "error", "message": str(e)}, status=400)
    elif request.method == "GET":
        return JsonResponse(export_db_to_json(request=request), status=200)

def get_banner_image(request, banner_id):
    banner = get_object_or_404(Banner, pk=banner_id)
    if not banner.imagem_blob:
        raise Http404("Image does not exist")
    
    return HttpResponse(
        banner.imagem_blob, 
        content_type=banner.imagem_mime_type or 'image/png'
    )
    
def export_db_to_json(request=None):
    banners_dict = {}
    build_banner_map = {}
    ref_banner_map = {}

    for banner in Banner.objects.all():
        banner_id_str = str(banner.id)
        
        if banner.imagem_blob:
            image_url = reverse('banner_image', args=[banner.id])
            if request:
                image_url = request.build_absolute_uri(image_url)
        else:
            image_url = ""

        banners_dict[banner_id_str] = {
            "image": image_url,
            "title": banner.titulo or "",
            "description": banner.descricao or ""
        }

        if banner.construcao_id is not None:
            build_banner_map[banner.construcao_id] = banner.id
        if banner.referencia_id is not None:
            ref_banner_map[banner.referencia_id] = banner.id

    areas_dict = {}
    build_areas_map = defaultdict(list)
    for area in ConstrucaoRegiao.objects.all():
        area_id_str = str(area.id)
        areas_dict[area_id_str] = {
            "min": area.min,
            "max": area.max
        }
        if area.construcao_id is not None:
            build_areas_map[area.construcao_id].append(area.id)

    references_dict = {}
    build_entrances_map = defaultdict(list)
    for ref in Referencia.objects.all():
        ref_id_str = str(ref.id)
        references_dict[ref_id_str] = {
            "pos": ref.localizacao,
            "banner": ref_banner_map.get(ref.id)
        }
        if ref.construcao_id is not None:
            build_entrances_map[ref.construcao_id].append(ref.id)

    buildings_dict = {}
    for build in Construcao.objects.all():
        build_id_str = str(build.id)
        buildings_dict[build_id_str] = {
            "name": build.nome or "",
            "pin": build.localizacao_pino,
            "areas": build_areas_map.get(build.id, []),
            "entrances": build_entrances_map.get(build.id, []),
            "banner": build_banner_map.get(build.id)
        }

    connections_dict = {}
    for route in Rota.objects.all():
        start_id = route.local_inicio_id
        end_id = route.local_fim_id
        if start_id is not None and end_id is not None:
            conn_key = f"{start_id},{end_id}"
            connections_dict[conn_key] = {
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