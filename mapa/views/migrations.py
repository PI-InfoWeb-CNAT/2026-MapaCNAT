import os
from django.conf import settings
from django.http import HttpResponse
from mapa.models import Mapa, Construcao, Rota, Banner, Referencia, ConstrucaoRegiao
from django.template import loader

def migrate_mapa(request):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render())

    if Mapa.objects.count() == 0:
        caminho_svg = os.path.join(settings.BASE_DIR, 'static', 'svg', 'mapa.svg')
        
        svg_bytes = b""
        if os.path.exists(caminho_svg):
            with open(caminho_svg, 'rb') as f:
                svg_bytes = f.read()
        
        mapa_padrao = Mapa.objects.create(
            nome="Mapa CNAT",
            svg_blob=svg_bytes
        )
    else:
        mapa_padrao = Mapa.objects.first()

    Construcao.objects.filter(mapa__isnull=True).update(mapa=mapa_padrao)
    Rota.objects.filter(mapa__isnull=True).update(mapa=mapa_padrao)
    Banner.objects.filter(mapa__isnull=True).update(mapa=mapa_padrao)
    Referencia.objects.filter(mapa__isnull=True).update(mapa=mapa_padrao)
    ConstrucaoRegiao.objects.filter(mapa__isnull=True).update(mapa=mapa_padrao)

    return HttpResponse("Verificação concluída: Mapa CNAT garantido e registros vinculados com sucesso!")