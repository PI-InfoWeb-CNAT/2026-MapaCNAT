from django import forms
from django.contrib.auth.models import User

class NewAdminForm(forms.Form):
    email = forms.EmailField(
        label="E-mail do Usuário",
        widget=forms.EmailInput(attrs={'class': 'form-control', 'placeholder': 'user@exemplo.com'})
    )

    def clean_email(self):
        email = self.cleaned_data.get('email')
        if not User.objects.filter(email=email).exists():
            raise forms.ValidationError("Nenhum usuário encontrado com este e-mail.")
        return email