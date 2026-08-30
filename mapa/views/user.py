from django.http import HttpResponse
from django.template import loader
from typing import Any

def login(request: Any):
    template = loader.get_template('login.html')
    return HttpResponse(template.render())

def register(request: Any):
    template = loader.get_template('register.html')
    return HttpResponse(template.render())