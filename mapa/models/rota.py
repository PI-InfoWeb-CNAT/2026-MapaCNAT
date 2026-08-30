from django.db import models
from mapa.models.referencia import Referencia

class Rota(models.Model):
    local_inicio = models.ForeignKey(Referencia, on_delete=models.CASCADE, related_name='referencia_inicio')
    local_fim = models.ForeignKey(Referencia, on_delete=models.CASCADE, related_name='referencia_final')