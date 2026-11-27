from django import forms
from django.contrib.auth import get_user_model

User = get_user_model()

class AdicionarStaffForm(forms.Form):
    action = forms.CharField(widget=forms.HiddenInput(), initial='add')
    email = forms.EmailField(
        label='E-mail',
        required=True,
        error_messages={
            'required': 'Informe o e-mail do servidor.',
            'invalid': 'Digite um endereço de e-mail válido.',
        },
        widget=forms.EmailInput(attrs={
            'id': 'staff-email',
            'autocomplete': 'off',
            'inputmode': 'email',
            'placeholder': 'nome@ifrn.edu.br',
        })
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.errors.get('email'):
            self.fields['email'].widget.attrs.update({
                'aria-invalid': 'true',
                'aria-describedby': 'staff-email-erro',
            })

    def clean_email(self):
        email = self.cleaned_data['email'].strip()
        try:
            usuario = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            raise forms.ValidationError('Nenhum usuário cadastrado com este e-mail.')
        except User.MultipleObjectsReturned:
            raise forms.ValidationError('Existe mais de uma conta com este e-mail. Contate o suporte.')

        if usuario.is_staff:
            raise forms.ValidationError('Este usuário já possui permissão de staff.')

        self.usuario_encontrado = usuario
        return email


class RemoverStaffForm(forms.Form):
    action = forms.CharField(widget=forms.HiddenInput(), initial='remove')
    user_id = forms.IntegerField(
        required=True,
        widget=forms.HiddenInput()
    )