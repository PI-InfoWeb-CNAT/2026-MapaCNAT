from django.db import migrations


def extrair_xy(ponto):
    if isinstance(ponto, (list, tuple)) and len(ponto) == 2:
        return ponto[0], ponto[1]
    if isinstance(ponto, dict) and "x" in ponto and "y" in ponto:
        return ponto["x"], ponto["y"]
    return None


def migrar_regioes_para_coordenadas(apps, schema_editor):
    # Evita erro caso algum ambiente local já esteja sem a tabela
    if "mapa_construcaoregiao" not in schema_editor.connection.introspection.table_names():
        return

    Construcao = apps.get_model("mapa", "Construcao")
    ConstrucaoRegiao = apps.get_model("mapa", "ConstrucaoRegiao")

    for construcao in Construcao.objects.all():
        if construcao.coordinates:
            continue

        regiao = ConstrucaoRegiao.objects.filter(construcao=construcao).first()
        if not regiao:
            continue

        p_min = extrair_xy(regiao.min)
        p_max = extrair_xy(regiao.max)

        if p_min and p_max:
            x1, y1 = p_min
            x2, y2 = p_max
            # Converte o retângulo [min, max] em um polígono fechado de 4 vértices
            construcao.coordinates = [
                [x1, y1],
                [x2, y1],
                [x2, y2],
                [x1, y2],
            ]
            construcao.save(update_fields=["coordinates"])


class Migration(migrations.Migration):

    dependencies = [
        # Mantenha aqui a dependency gerada automaticamente pelo --empty (a Migration 1)
        ("mapa", "0019_construcao_coordinates"),
    ]

    operations = [
        migrations.RunPython(
            migrar_regioes_para_coordenadas,
            reverse_code=migrations.RunPython.noop,
        ),
    ]