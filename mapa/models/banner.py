from django.db import models
from . import *

class Banner(models.Model):
    titulo = models.CharField(max_length=255, blank=True, default="Nome da construção")
    descricao = models.TextField(blank=True, default="")
    imagem = models.ImageField(upload_to='banners/', blank=True, null=True)
    
    referencia = models.ForeignKey(
        Referencia, 
        on_delete=models.CASCADE, 
        related_name='banners', 
        null=True, 
        blank=True
    )
    construcao = models.ForeignKey(
        Construcao, 
        on_delete=models.CASCADE, 
        related_name='banners', 
        null=True, 
        blank=True
    )

    def __str__(self):
        owner = self.referencia or self.construcao
        return f"Banner: {self.titulo} ({owner})"