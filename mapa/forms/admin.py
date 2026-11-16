from django import forms
from django.contrib.auth.models import User
import xml.etree.ElementTree as ET
from mapa.models.mapa import Mapa, _par
import json

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


class NovoMapaForm(forms.Form):
    """Cria e edita. Na edição, passe mapa=<instância>: o SVG vira opcional
    e a checagem de nome duplicado ignora o próprio mapa."""

    nome = forms.CharField(
        label='Nome do campus',
        max_length=120,
        required=True,
        error_messages={
            'required': 'Informe o nome do campus.',
            'max_length': 'O nome deve ter no máximo 120 caracteres.',
        },
        widget=forms.TextInput(attrs={
            'id': 'mapa-nome',
            'placeholder': 'Ex.: Campus Natal - Central',
        })
    )

    svg = forms.FileField(
        label='Imagem do mapa (SVG)',
        required=True,
        error_messages={
            'required': 'Selecione um arquivo SVG.',
        },
        widget=forms.ClearableFileInput(attrs={
            'id': 'mapa-svg',
            'accept': '.svg,image/svg+xml',
            'aria-describedby': 'mapa-svg-dica mapa-svg-erro',
        })
    )

    # preenchido pelo landmarker.js
    coordinates = forms.CharField(required=False, widget=forms.HiddenInput)

    def __init__(self, *args, mapa=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.mapa = mapa
        self.svg_bytes = None
        if mapa is not None:
            self.fields['svg'].required = False
        if self.errors.get('nome'):
            self.fields['nome'].widget.attrs.update({
                'aria-invalid': 'true',
                'aria-describedby': 'mapa-nome-erro',
            })
        if self.errors.get('svg'):
            self.fields['svg'].widget.attrs.update({
                'aria-invalid': 'true',
            })

    def clean_nome(self):
        nome = self.cleaned_data['nome'].strip()
        existentes = Mapa.objects.filter(nome__iexact=nome)
        if self.mapa is not None:
            existentes = existentes.exclude(pk=self.mapa.pk)
        if existentes.exists():
            raise forms.ValidationError('Já existe um mapa cadastrado com este nome.')
        return nome

    def clean_svg(self):
        arquivo = self.cleaned_data.get('svg')
        if not arquivo:                      # edição sem trocar o SVG
            return None

        # 1. Tamanho máximo: 20 MB
        max_bytes = 20 * 1024 * 1024
        if arquivo.size > max_bytes:
            raise forms.ValidationError('O arquivo excede o limite de 20 MB.')

        # 2. Extensão e leitura do conteúdo
        if not arquivo.name.lower().endswith('.svg'):
            raise forms.ValidationError('Envie um arquivo com extensão .svg.')

        raw_bytes = arquivo.read()
        arquivo.seek(0)

        # 3. Validação estrutural XML + viewBox ou width/height
        try:
            root = ET.fromstring(raw_bytes)
        except ET.ParseError:
            raise forms.ValidationError('O arquivo enviado não é um XML/SVG válido.')

        if not root.tag.endswith('svg'):
            raise forms.ValidationError('A raiz do arquivo deve ser uma tag <svg>.')

        has_viewbox = 'viewBox' in root.attrib
        has_dimensions = 'width' in root.attrib and 'height' in root.attrib
        if not (has_viewbox or has_dimensions):
            raise forms.ValidationError(
                'O SVG precisa ter viewBox ou width e height definidos.'
            )

        self.svg_bytes = raw_bytes
        return arquivo

    def clean_coordinates(self):
        bruto = self.cleaned_data.get('coordinates')
        if not bruto:
            return []

        try:
            dados = json.loads(bruto)
        except ValueError:
            dados = None
        if not (isinstance(dados, list) and len(dados) == 3):
            raise forms.ValidationError('Pontos de referência inválidos.')

        pontos = []
        for p in dados:
            if not isinstance(p, dict):
                raise forms.ValidationError('Pontos de referência inválidos.')
            svg, geo = p.get('svg'), p.get('geo')
            if geo is not None and not (_par(geo) and abs(geo[0]) <= 90 and abs(geo[1]) <= 180):
                raise forms.ValidationError('Coordenada geográfica inválida.')
            if svg is not None and not _par(svg):
                raise forms.ValidationError('Coordenada do SVG inválida.')
            pontos.append({'svg': svg, 'geo': geo})

        # nenhuma marcação -> lista vazia ("não configurado")
        return pontos if any(p['svg'] or p['geo'] for p in pontos) else []