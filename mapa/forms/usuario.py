from django.forms import ModelForm
from mapa.models.perfil import UsuarioProfile

class UserProfileForm(ModelForm):
    """Updates profile details for standard users (self-service)."""
    class Meta:
        model = UsuarioProfile
        fields = []