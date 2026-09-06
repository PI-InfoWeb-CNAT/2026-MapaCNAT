from . import *

class UsuarioProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    perfil = models.IntegerField(choices=PERFIL, default=2)
    criado_em = models.DateTimeField(auto_now_add=True)
    alterado_em = models.DateTimeField(auto_now=True)
    token = models.CharField(max_length=255, null=True, blank=True)
    aniversario = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.user.username} ({self.get_perfil_display()})"

    @property
    def is_admin(self):
        return self.perfil == 1 or self.user.is_superuser

@receiver(post_save, sender=User)
def create_or_save_user_profile(sender, instance, created, **kwargs):
    if created:
        UsuarioProfile.objects.create(user=instance, perfil=2)
    else:
        instance.profile.save()