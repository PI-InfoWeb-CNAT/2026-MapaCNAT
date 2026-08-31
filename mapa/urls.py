from django.urls import path
from . import views

urlpatterns = [
    path('mapa/', views.mapa, name='mapa'),
    path('login/', views.login, name='login'),
    path('register/', views.register, name='register'),
    path('mapa/editor/', views.mapa_editor, name='mapa_editor'),
    path('mapa/editor/save', views.mapa_editor_data, name='mapa_editor_data'),
    path('', views.home, name='home'),
]