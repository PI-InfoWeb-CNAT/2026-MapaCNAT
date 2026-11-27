from django.db import models
from django.core.exceptions import ValidationError
from django.core.validators import MinLengthValidator, MaxLengthValidator

def validate_coordinate_pairs(value):
    if not isinstance(value, list):
        raise ValidationError("As coordenadas devem ser uma lista de pares.")
    
    for pair in value:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValidationError(f"O item {pair} deve conter exatamente 2 valores [x, y].")
        
        x, y = pair
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise ValidationError(f"As coordenadas em {pair} devem ser valores numéricos.")
        
class Construcao(models.Model):
    nome = models.CharField(max_length=255)
    localizacao_pino = models.JSONField(default=list, validators=[MinLengthValidator(2), MaxLengthValidator(2)])
    mapa = models.ForeignKey(
        "Mapa",
        null=True,
        on_delete=models.CASCADE,
        related_name="construcoes",
    )
    coordinates = models.JSONField(
        default=list,
        validators=[
            MinLengthValidator(3),
            validate_coordinate_pairs
        ],
    )