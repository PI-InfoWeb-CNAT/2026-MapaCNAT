import os
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import render
from mapa.models import Mapa, Construcao, Rota, Banner, Referencia, ConstrucaoRegiao


def migrate_mapa(request):
    if not request.user.is_staff:
        return render(request, '404.html', status=404)

    caminho_svg = os.path.join(settings.BASE_DIR, 'static', 'svg', 'mapa.svg')
    svg_bytes = b""
    if os.path.exists(caminho_svg):
        with open(caminho_svg, 'rb') as f:
            svg_bytes = f.read()

    coordenadas_iniciais = [
        {
            "svg": [2816.41, 2154.88],
            "geo": [-5.8127165, -35.2049893]
        },
        {
            "svg": [2816.8, 22.12],
            "geo": [-5.8136425, -35.2023976]
        },
        {
            "svg": [7.84, 25.94],
            "geo": [-5.8111207, -35.2014561]
        }
    ]

    with transaction.atomic():
        # 1. Renomeia qualquer mapa existente com o nome "MapaCNAT" antes de criar o novo
        for mapa_antigo in Mapa.objects.filter(nome="MapaCNAT"):
            mapa_antigo.nome = f"MapaCNAT_antigo_{mapa_antigo.id}"
            mapa_antigo.save(update_fields=['nome'])

        # 2. Cria o novo mapa padrão
        novo_mapa = Mapa.objects.create(
            nome="MapaCNAT",
            svg_blob=svg_bytes,
            coordinates=coordenadas_iniciais,
            public='publico'
        )

        # 3. Redireciona todos os registros para o novo mapa
        Construcao.objects.all().update(mapa=novo_mapa)
        Rota.objects.all().update(mapa=novo_mapa)
        Banner.objects.all().update(mapa=novo_mapa)
        Referencia.objects.all().update(mapa=novo_mapa)
        ConstrucaoRegiao.objects.all().update(mapa=novo_mapa)

        # 4. Apaga todos os outros mapas antigos
        mapas_removidos, _ = Mapa.objects.exclude(pk=novo_mapa.pk).delete()

    return HttpResponse(
        f"Migração concluída: novo MapaCNAT (ID {novo_mapa.id}) criado, "
        f"registros vinculados e {mapas_removidos} mapa(s) antigo(s) removido(s)."
    )