from django.http import HttpResponse
from django.template import loader

def mapa(request):
    template = loader.get_template('mapa.html')
    return HttpResponse(template.render())

def home(request):
    template = loader.get_template('home.html')
    return HttpResponse(template.render())

def login(request):
    template = loader.get_template('login.html')
    return HttpResponse(template.render())

def register(request):
    template = loader.get_template('register.html')
    return HttpResponse(template.render())

def mapa_editor(request):
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render())