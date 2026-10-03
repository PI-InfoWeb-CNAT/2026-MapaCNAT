from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render
from typing import Any
from mapa.forms.feedback import FeedbackForm
from mapa.models.feedback import Feedback

def home(request: Any):
    template = loader.get_template('home.html')
    context = {
            # "user": request.user,
            "is_authenticated": request.user.is_authenticated
        }
    return HttpResponse(template.render(context))

def feedback(request: Any):
    form = FeedbackForm()
    context = {
            "is_authenticated": request.user.is_authenticated,
            "form": form
        }

    if request.method == 'POST':
        rating = request.POST.get('rating')
        comment = request.POST.get('comment')
        Feedback.objects.create(
            rating=rating,
            comment=comment,
            user=request.user
        )

        context['success'] = True
        
    return render(request, 'feedback.html', context)