from django.http import HttpResponse, JsonResponse, JsonResponse, HttpRequest
from django.template import loader
from django.templatetags.static import static
from typing import Any
from mapa.models.banner import Banner

def mapa(request: Any):
    lat = request.GET.get('lat')
    long = request.GET.get('long')
    context = {}
    if lat and long:
        context["lat"] = lat
        context["long"] = long
    template = loader.get_template('mapa.html')
    return HttpResponse(template.render(context=context))

def name_search(request: HttpRequest):
    query = request.GET.get('q', '').strip()

    if query:
        banners = Banner.objects.filter(titulo__icontains=query)
    else:
        banners = Banner.objects.all()

    default_image = static('img/ifrn-logo.png')

    results = [
        {
            "title": banner.titulo,
            "description": banner.descricao,
            "image": banner.imagem.url if banner.imagem else default_image,
        }
        for banner in banners
    ]

    return JsonResponse(results, safe=False)