from django.core.validators import MaxLengthValidator, MinLengthValidator
from django.db import models
import json
import math

def _par(v):
    return (
        isinstance(v, list) and len(v) == 2
        and all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in v)
    )

def _seno(t):
    """Seno do ângulo no 1º vértice: ~0 quando os 3 pontos estão alinhados."""
    (x1, y1), (x2, y2), (x3, y3) = t
    d = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
    base = math.hypot(x2 - x1, y2 - y1) * math.hypot(x3 - x1, y3 - y1)
    return abs(d) / base if base else 0.0


def calcular_afim(pontos):
    """3 × {"svg": [x, y], "geo": [lat, lng]} -> [a, b, c, d, e, f] ou None.
         lng = a·x + b·y + c
         lat = d·x + e·y + f
    Mesma conta do landmarker.js."""
    svg = [p["svg"] for p in pontos]
    geo = [p["geo"] for p in pontos]
    if not (_seno(svg) > 0.02 and _seno(geo) > 0.02):
        return None

    (x1, y1), (x2, y2), (x3, y3) = svg
    D = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)

    def resolver(u1, u2, u3):
        a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / D
        b = ((x2 - x1) * (u3 - u1) - (x3 - x1) * (u2 - u1)) / D
        return a, b, u1 - a * x1 - b * y1

    a, b, c = resolver(*(g[1] for g in geo))   # lng
    d, e, f = resolver(*(g[0] for g in geo))   # lat
    return [a, b, c, d, e, f]

class Mapa(models.Model):
    nome = models.CharField(
        max_length=255, blank=True, unique=True, default="Mapa sem Nome"
    )
    svg_blob = models.BinaryField(null=True, blank=True)
    public = models.CharField(max_length=32, default="privado")
    coordinates = models.JSONField(
        default=list,
        validators=[MinLengthValidator(3), MaxLengthValidator(3)],
    )

    def __str__(self):
        return f"Mapa: {self.nome}"

    @property
    def tem_svg(self):
        tamanho = getattr(self, "svg_tamanho", None)
        return bool(tamanho) if tamanho is not None else bool(self.svg_blob)

    @property
    def coordinates_json(self):
        return json.dumps(self.coordinates) if self.coordinates else ""

    @property
    def matriz_afim(self):
        pts = self.coordinates
        if not (isinstance(pts, list) and len(pts) == 3):
            return None
        if not all(isinstance(p, dict) and _par(p.get("svg")) and _par(p.get("geo")) for p in pts):
            return None
        return calcular_afim(pts)

    @property
    def configuracao_completa(self):
        return self.tem_svg and self.matriz_afim is not None