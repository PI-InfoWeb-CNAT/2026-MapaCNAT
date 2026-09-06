from django.http import HttpResponse
from django.template import loader
from typing import Any

def home(request: Any):
    template = loader.get_template('home.html')
    context = {
            # "user": request.user,
            "is_authenticated": request.user.is_authenticated
        }
    return HttpResponse(template.render(context))