from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from mapa.models import MapaVersao

class Command(BaseCommand):
    def handle(self, *args, **opts):
        now = timezone.now()
        keep, seen = set(), set()
        qs = (MapaVersao.objects.defer("dados").order_by("mapa_id", "-criado_em"))
        for v in qs:
            age = now - v.criado_em
            if v.motivo in ("manual", "restore") or age < timedelta(hours=24):
                keep.add(v.pk); continue
            bucket = v.criado_em.strftime("%Y%m%d%H") if age < timedelta(days=7) else v.criado_em.strftime("%Y%m%d")
            key = (v.mapa_id, bucket)
            if key not in seen:
                seen.add(key); keep.add(v.pk)
        MapaVersao.objects.exclude(pk__in=keep).delete()