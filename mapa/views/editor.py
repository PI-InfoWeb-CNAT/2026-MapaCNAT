from functools import wraps
from collections import defaultdict
from typing import Any
import json
import hashlib

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpResponse, JsonResponse, Http404
from django.shortcuts import get_object_or_404
from django.template import loader
from django.urls import reverse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from django.contrib.admin.views.decorators import staff_member_required

from ..models import *
import mapa.models.versioning as versioning

@login_required
@staff_member_required
def mapa_editor(request: Any, mapa_id):
    print("a")
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render(), status=404)

    mapa = get_object_or_404(Mapa, pk=mapa_id)
    context = {
        "mapa": mapa
    }

    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render(context=context, request=request))

def apply_map_data(mapa, data, get_image):
    with transaction.atomic():
        Mapa.objects.select_for_update().get(pk=mapa.pk)

        Rota.objects.filter(mapa=mapa).delete()
        Referencia.objects.filter(mapa=mapa).delete()
        Construcao.objects.filter(mapa=mapa).delete()
        Banner.objects.filter(mapa=mapa).delete()

        ref_db_map = {}
        build_db_map = {}

        buildings_data = data.get("buildings", {})
        references_data = data.get("references", {})
        banners_data = data.get("banners", {})
        connections_data = data.get("connections", {})

        ref_to_build_id = {}
        for b_id, b_info in buildings_data.items():
            for entrance_ref_id in b_info.get("entrances", []):
                ref_to_build_id[str(entrance_ref_id)] = str(b_id)

        for b_id, b_info in buildings_data.items():
            construcao = Construcao.objects.create(
                mapa=mapa,
                nome=b_info.get("name", ""),
                coordinates=b_info.get("polygon", []),
                localizacao_pino=b_info.get("pin", {"x": 0, "y": 0}),
            )
            build_db_map[str(b_id)] = construcao

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
            mode = banner_info.get("mode", "")
            priority = banner_info.get("priority", 1)
            image = get_image(banner_id, banner_info)

            if image is None and not title and not description:
                continue

            image_bytes = None
            mime_type = None

            image_bytes, mime_type = image if image else (None, None)
            sha = hashlib.sha256(image_bytes).hexdigest() if image_bytes else None

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
                mode=mode,
                priority=priority,
                imagem_blob=image_bytes,
                imagem_mime_type=mime_type,
                imagem_sha256=sha,
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

def _files_getter(request):
    def get(banner_id, info):
        f = request.FILES.get(f"file_{banner_id}")
        return (f.read(), f.content_type or "image/png") if f else None
    return get

@login_required
@staff_member_required
@ensure_csrf_cookie
@require_POST
def mapa_editor_data(request: Any, mapa_id):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render(), status=404)
    
    mapa = get_object_or_404(Mapa, pk=mapa_id)

    try:
        raw_data = request.POST.get('data')
        MAX_PAYLOAD_SIZE = 1024 * 1024 * 5
        
        if raw_data and len(raw_data) > MAX_PAYLOAD_SIZE:
            raise ValueError("Payload too large")
        if raw_data:
            data = json.loads(raw_data)
        else:
            data = json.loads(request.body)

        with transaction.atomic():
            Mapa.objects.select_for_update().get(pk=mapa.pk)
            versioning.snapshot_before_overwrite(mapa, request.user, data)
            apply_map_data(mapa, data, _files_getter(request))

        return JsonResponse({"status": "success"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=400)


@ensure_csrf_cookie
@require_GET
def mapa_data_load(request, mapa_id):
    mapa = get_object_or_404(Mapa, pk=mapa_id)

    raw = request.GET.get("versao")
    if raw is None:
        return JsonResponse(export_db_to_json(mapa, request=request), status=200)

    if not (request.user.is_authenticated and request.user.is_staff):
        return JsonResponse({"error": "forbidden"}, status=403)
    try:
        numero = int(raw)
    except ValueError:
        return JsonResponse({"error": "invalid version"}, status=400)

    versao = get_object_or_404(MapaVersao, mapa=mapa, numero=numero)
    return JsonResponse(versioning.render_snapshot(versao, request), status=200)

@login_required
@staff_member_required
@require_GET
def mapa_versoes(request, mapa_id):
    mapa = get_object_or_404(Mapa, pk=mapa_id)
    try:
        limit = min(int(request.GET.get("limit", 50)), 200)
        before = request.GET.get("before")
        before = int(before) if before else None
    except ValueError:
        return JsonResponse({"error": "invalid params"}, status=400)

    qs = mapa.versoes.defer("dados").select_related("criado_por")
    if before:
        qs = qs.filter(numero__lt=before)
    items = list(qs[:limit + 1])

    return JsonResponse({
        "versions": [{
            "numero": v.numero,
            "criado_em": v.criado_em.isoformat(),
            "criado_por": v.criado_por.get_username() if v.criado_por else None,
            "motivo": v.motivo,
            "resumo": v.resumo,
        } for v in items[:limit]],
        "next_before": items[limit - 1].numero if len(items) > limit else None,
    })

@login_required
@staff_member_required
@require_GET
def versao_imagem(request, mapa_id, sha):
    img = get_object_or_404(MapaImagem, pk=sha)
    resp = HttpResponse(bytes(img.blob), content_type=img.mime_type)
    resp["Cache-Control"] = "private, max-age=31536000, immutable"
    return resp


@login_required
@staff_member_required
@require_POST
def mapa_restaurar_versao(request, mapa_id, numero):
    mapa = get_object_or_404(Mapa, pk=mapa_id)
    with transaction.atomic():
        Mapa.objects.select_for_update().get(pk=mapa.pk)
        versao = get_object_or_404(MapaVersao, mapa=mapa, numero=numero)

        versioning.snapshot(mapa, request.user, MapaVersao.Motivo.RESTORE)

        shas = {b.get("image") for b in versao.dados.get("banners", {}).values() if b.get("image")}
        images = {i.sha256: (bytes(i.blob), i.mime_type) for i in MapaImagem.objects.filter(sha256__in=shas)}
        apply_map_data(mapa, versao.dados, lambda _id, info: images.get(info.get("image")))

    return JsonResponse({"status": "success"})

def get_banner_image(request, banner_id):
    banner = get_object_or_404(Banner, pk=banner_id)
    if not banner.imagem_blob:
        raise Http404("Image does not exist")

    return HttpResponse(
        banner.imagem_blob,
        content_type=banner.imagem_mime_type or 'image/png'
    )


def export_db_to_json(mapa, request=None, image_url=None):
    banners_dict = {}
    build_banner_map = {}
    ref_banner_map = {}

    for banner in Banner.objects.filter(mapa=mapa).defer("imagem_blob"):
        banner_id_str = str(banner.id)

        if banner.imagem_mime_type:
            if image_url:                      # snapshots: store the sha
                url = image_url(banner)
            else:
                url = reverse('banner_image', args=[banner.id])
                if request:
                    url = request.build_absolute_uri(url)
        else:
            url = ""

        banners_dict[banner_id_str] = {
            "image": url,
            "title": banner.titulo or "",
            "description": banner.descricao or "",
            "alias": banner.name_alias or [],
            "mode": banner.mode or "",
            "priority": banner.priority or 1,
        }

        if banner.construcao_id is not None:
            build_banner_map[banner.construcao_id] = banner.id
        if banner.referencia_id is not None:
            ref_banner_map[banner.referencia_id] = banner.id

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
            "polygon": build.coordinates or [],
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
        "connections": connections_dict,
        "files": {}
    }