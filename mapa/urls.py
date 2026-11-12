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
    path('mapa/editor/load', views.mapa_data_load, name='mapa_editor_load'),
    # path('mapa/search', views.name_search, name="name_search"),
    path('feedback/', views.feedback, name='feedback'),
    path('banner/<int:banner_id>/image/', views.get_banner_image, name='banner_image'),
    # path('user/share/generate/', views.generate_token_endpoint, name='generate_share'),
    # path('user/share/resolve/', views.resolve_token_endpoint, name='resolve_share'),
    path('', views.home, name='home'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)