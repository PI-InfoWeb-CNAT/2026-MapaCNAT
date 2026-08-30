from django.http import HttpResponse
from django.template import loader
from typing import Any

def home(request: Any):
    template = loader.get_template('home.html')
    return HttpResponse(template.render())