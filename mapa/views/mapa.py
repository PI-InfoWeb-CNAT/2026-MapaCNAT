from django.db.models import Q
from django.http import HttpResponse, JsonResponse, JsonResponse, HttpRequest
from django.template import loader
from django.templatetags.static import static
from typing import Any
from mapa.models.banner import Banner
from mapa.models.mapa import Mapa
from django.shortcuts import get_object_or_404

def mapa_view(request: Any, mapa_id):
    mapa = get_object_or_404(Mapa, pk=mapa_id)

    if not mapa.public:
        template = loader.get_template('mapa-manutencao.html')
        return HttpResponse(template.render())    

    lat = request.GET.get('lat')
    long = request.GET.get('long')
    render = request.GET.get('showpin')
    context = {
        "user": request.user,
        "mapa": mapa,
        "r": 0,
    }
    if lat and long:
        context["lat"] = lat
        context["long"] = long
        context["r"] = render
    template = loader.get_template('mapa.html')
    return HttpResponse(template.render(context=context))

def campi_view(request: Any):
    nome = request.GET.get("nome", "").strip()
    estado = request.GET.get("estado")

    mapas = Mapa.objects.filter(Q(public='publico') | Q(public='manutencao'))

    if nome:
        mapas = mapas.filter(nome__icontains=nome)
    if estado:
        mapas = mapas.filter(public=str(estado))

    context = {
        "user": request.user,
        "mapas": mapas
    }
    template = loader.get_template('campi.html')
    return HttpResponse(template.render(context=context, request=request))

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