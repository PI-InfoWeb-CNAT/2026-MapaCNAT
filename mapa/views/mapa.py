from django.http import HttpResponse
from django.template import loader
from typing import Any

def mapa(request: Any):
    template = loader.get_template('mapa.html')
    return HttpResponse(template.render())