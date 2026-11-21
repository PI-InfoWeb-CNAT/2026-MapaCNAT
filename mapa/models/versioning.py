import copy
import hashlib
from datetime import timedelta

from django.db.models import Max
from django.urls import reverse
from django.utils import timezone

from mapa.models import *

SNAPSHOT_INTERVAL = timedelta(minutes=5)
SHRINK_RATIO = 0.7
MIN_OBJECTS_TO_PROTECT = 5


def live_counts(mapa):
    return {
        "buildings": Construcao.objects.filter(mapa=mapa).count(),
        "references": Referencia.objects.filter(mapa=mapa).count(),
        "connections": Rota.objects.filter(mapa=mapa).count(),
        "banners": Banner.objects.filter(mapa=mapa).count(),
    }


def payload_counts(data):
    return {k: len(data.get(k) or {}) for k in ("buildings", "references", "connections", "banners")}


def _total(c):
    return c["buildings"] + c["references"] + c["connections"]


def _ensure_images(mapa):
    """Makes sure every banner image exists in MapaImagem and that Banner.imagem_sha256 is filled."""
    # banners that predate the sha field: hash them now (one-time cost)
    for b in Banner.objects.filter(mapa=mapa, imagem_sha256__isnull=True).exclude(imagem_blob__isnull=True):
        b.imagem_sha256 = hashlib.sha256(bytes(b.imagem_blob)).hexdigest()
        b.save(update_fields=["imagem_sha256"])

    shas = set(
        Banner.objects.filter(mapa=mapa, imagem_sha256__isnull=False)
        .values_list("imagem_sha256", flat=True)
    )
    known = set(MapaImagem.objects.filter(sha256__in=shas).values_list("sha256", flat=True))
    for sha in shas - known:
        b = Banner.objects.filter(mapa=mapa, imagem_sha256=sha).first()
        MapaImagem.objects.get_or_create(
            sha256=sha,
            defaults={"blob": b.imagem_blob, "mime_type": b.imagem_mime_type or "image/png"},
        )


def snapshot(mapa, user, motivo):
    from mapa.views.editor import export_db_to_json

    _ensure_images(mapa)
    dados = export_db_to_json(mapa, image_url=lambda banner: banner.imagem_sha256 or "")
    numero = (mapa.versoes.aggregate(m=Max("numero"))["m"] or 0) + 1
    return MapaVersao.objects.create(
        mapa=mapa, numero=numero, criado_por=user, motivo=motivo,
        resumo=live_counts(mapa), dados=dados,
    )


def snapshot_before_overwrite(mapa, user, new_data):
    old = live_counts(mapa)
    if _total(old) == 0 and old["banners"] == 0:
        return None
    new = payload_counts(new_data)
    shrink = _total(old) >= MIN_OBJECTS_TO_PROTECT and _total(new) < _total(old) * SHRINK_RATIO

    last = mapa.versoes.only("criado_em").first()
    stale = last is None or timezone.now() - last.criado_em >= SNAPSHOT_INTERVAL

    if shrink or stale:
        return snapshot(mapa, user, MapaVersao.Motivo.SHRINK if shrink else MapaVersao.Motivo.AUTO)
    return None


def render_snapshot(versao, request):
    """Same shape as the live load endpoint: sha → absolute image URL."""
    data = copy.deepcopy(versao.dados)
    for banner in data.get("banners", {}).values():
        sha = banner.get("image")
        banner["image"] = (
            request.build_absolute_uri(reverse("versao_imagem", args=[versao.mapa_id, sha]))
            if sha else ""
        )
    return data