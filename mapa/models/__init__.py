from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

from .construcao import *
from .referencia import *
from .rota import *

PERFIL = (
    (1, 'Admin'),
    (2, 'Usuario'),
)

from .perfil import UsuarioProfile