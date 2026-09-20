from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from . import views

urlpatterns = [
    path('mapa/', views.mapa, name='mapa'),
    path('login/', views.login, name='login'),
    path('logout/', views.logout, name='logout'),
    path('register/', views.register, name='register'),
    path('mapa/editor/', views.mapa_editor, name='mapa_editor'),
    path('mapa/editor/save', views.mapa_editor_data, name='mapa_editor_data'),
    path('', views.home, name='home'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)