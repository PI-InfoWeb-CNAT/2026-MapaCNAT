from django.db import models
from django.core.validators import MinLengthValidator, MaxLengthValidator

class Construcao(models.Model):
    nome = models.CharField(max_length=255)
    localizacao_pino = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])

class ConstrucaoRegiao(models.Model):
    posicao = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])
    tamanho = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])
    construcao = models.ForeignKey(Construcao, on_delete=models.CASCADE, related_name='regiao')