from django.db import models
from django.core.validators import MinLengthValidator, MaxLengthValidator

class Referencia(models.Model):
    localizacao = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])