from django.http import HttpResponse
from django.template import loader
from typing import Any
from ..models import *

def admin(request: Any):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render())
        
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render())