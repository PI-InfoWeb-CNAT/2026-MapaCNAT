from django.db import models
from django.core.validators import MinLengthValidator, MaxLengthValidator
from . import *

class Referencia(models.Model):
    localizacao = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])
    mapa = models.ForeignKey(
        "Mapa",
        null=True,
        on_delete=models.CASCADE,
        related_name="referencias",
    )
    construcao = models.ForeignKey(
        Construcao,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='entradas'
    )