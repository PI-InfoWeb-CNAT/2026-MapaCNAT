from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from . import views

urlpatterns = [
    path('mapa/<int:mapa_id>/', views.mapa_view, name='mapa'),
    path('mapa/', views.campi_view, name='campi'),
    path('auth/login/', views.login, name='login'),
    path('auth/register/', views.register, name='register'),
    path('auth/logout/', views.logout, name='logout'),
    path('auth/google/callback/', views.google_callback, name='google_callback'),
    path('mapa/admin/', views.admin_view, name='painel_hub'),
    path('mapas/<int:pk>/editar/', views.mapa_editar, name='mapa_editar'),
    path('mapas/<int:pk>/apagar/', views.mapa_apagar, name='mapa_apagar'),
    path('mapas/<int:pk>/publicar/', views.mapa_publicar, name='mapa_publicar'),
    path('mapa/admin/staff', views.admin_staff, name='painel_staff'),
    path('mapa/admin/editor/<int:mapa_id>', views.mapa_editor, name='mapa_editor'),
    path('mapa/admin/editor/<int:mapa_id>/svg', views.mapa_svg_raw, name='mapa_svg_raw'),
    path('mapa/admin/editor/migrate', views.migrate_mapa, name='migrate_mapa'),
    path('mapa/admin/editor/<int:mapa_id>/save', views.mapa_editor_data, name='mapa_editor_data'),
    path('mapa/admin/editor/<int:mapa_id>/load', views.mapa_data_load, name='mapa_editor_load'),
    path('mapa/feedback/', views.give_feedback, name='feedback'),
    path('banner/<int:banner_id>/image/', views.get_banner_image, name='banner_image'),
    path('', views.home, name='home'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)