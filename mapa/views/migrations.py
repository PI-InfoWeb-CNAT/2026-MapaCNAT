from collections import defaultdict
from django.db import transaction
from django.http import JsonResponse
from django.views import View
from mapa.models.construcao import Construcao

def extrair_primeiro_poligono_puro(bboxes):
    """
    Recebe uma lista de bounding boxes no formato [(min_x, min_y, max_x, max_y), ...].
    Retorna a lista de vértices [{"x": ..., "y": ...}] do primeiro polígono fechado encontrado.
    """
    if not bboxes:
        return []

    # 1. Coleta todas as coordenadas únicas de X e Y para criar uma grade irregular
    xs = sorted(set(x for box in bboxes for x in (box[0], box[2])))
    ys = sorted(set(y for box in bboxes for y in (box[1], box[3])))

    if len(xs) < 2 or len(ys) < 2:
        return []

    x_idx = {x: i for i, x in enumerate(xs)}
    y_idx = {y: i for i, y in enumerate(ys)}

    # 2. Marca quais células da grade estão cobertas por pelo menos uma bounding box
    celulas_ocupadas = set()
    for min_x, min_y, max_x, max_y in bboxes:
        for i in range(x_idx[min_x], x_idx[max_x]):
            for j in range(y_idx[min_y], y_idx[max_y]):
                celulas_ocupadas.add((i, j))

    if not celulas_ocupadas:
        return []

    # 3. Extrai as arestas externas (arestas que não são compartilhadas por duas células)
    # As arestas são orientadas no sentido anti-horário ao redor da célula ocupada
    arestas = defaultdict(list)
    for i, j in celulas_ocupadas:
        # Borda inferior: esquerda -> direita
        if (i, j - 1) not in celulas_ocupadas:
            arestas[(i, j)].append((i + 1, j))
        # Borda direita: baixo -> cima
        if (i + 1, j) not in celulas_ocupadas:
            arestas[(i + 1, j)].append((i + 1, j + 1))
        # Borda superior: direita -> esquerda
        if (i, j + 1) not in celulas_ocupadas:
            arestas[(i + 1, j + 1)].append((i, j + 1))
        # Borda esquerda: cima -> baixo
        if (i - 1, j) not in celulas_ocupadas:
            arestas[(i, j + 1)].append((i, j))

    if not arestas:
        return []

    # 4. Percorre o primeiro ciclo fechado (ignora outras ilhas desconexas)
    ponto_inicial = min(arestas.keys())  # Começa pelo canto inferior esquerdo mais extremo
    atual = ponto_inicial
    caminho_indices = []
    visitados = set()

    while True:
        caminho_indices.append(atual)
        proximos = arestas.get(atual, [])
        
        # Escolhe uma aresta ainda não percorrida
        proximo = None
        for candidato in proximos:
            if (atual, candidato) not in visitados:
                proximo = candidato
                visitados.add((atual, candidato))
                break

        if proximo is None or proximo == ponto_inicial:
            break
        atual = proximo

    # Converte os índices da grade de volta para as coordenadas reais
    pontos_reais = [(xs[i], ys[j]) for i, j in caminho_indices]

    # 5. Simplifica o polígono removendo vértices colineares (pontos no meio de uma linha reta)
    n = len(pontos_reais)
    if n < 3:
        return []

    vertices_simplificados = []
    for k in range(n):
        prev_pt = pontos_reais[(k - 1) % n]
        curr_pt = pontos_reais[k]
        next_pt = pontos_reais[(k + 1) % n]

        # Se X não mudou nos 3 pontos OU Y não mudou nos 3 pontos, é uma reta contínua (ignora o ponto do meio)
        mesmo_x = prev_pt[0] == curr_pt[0] == next_pt[0]
        mesmo_y = prev_pt[1] == curr_pt[1] == next_pt[1]

        if not (mesmo_x or mesmo_y):
            vertices_simplificados.append({"x": curr_pt[0], "y": curr_pt[1]})

    return vertices_simplificados


class MigrarCoordenadasConstrucaoView(View):
    def post(self, request, *args, **kwargs):
        construcoes_atualizadas = 0
        construcoes_ignoradas = 0
        erros = []

        construcoes = Construcao.objects.prefetch_related("areas").all()

        with transaction.atomic():
            for construcao in construcoes:
                areas = construcao.areas.all()
                if not areas.exists():
                    construcoes_ignoradas += 1
                    continue

                bboxes = []

                for area in areas:
                    # Ajuste conforme o nome do campo JSON no seu model Area
                    coords = area.coordinates

                    try:
                        # Caso seja {"min": {"x": ..., "y": ...}, "max": {"x": ..., "y": ...}}
                        if isinstance(coords, dict) and "min" in coords and "max" in coords:
                            x1, y1 = float(coords["min"]["x"]), float(coords["min"]["y"])
                            x2, y2 = float(coords["max"]["x"]), float(coords["max"]["y"])
                        # Caso seja [{"x": ..., "y": ...}, {"x": ..., "y": ...}]
                        elif isinstance(coords, list) and len(coords) >= 2:
                            x1, y1 = float(coords[0]["x"]), float(coords[0]["y"])
                            x2, y2 = float(coords[1]["x"]), float(coords[1]["y"])
                        else:
                            continue

                        min_x, max_x = min(x1, x2), max(x1, x2)
                        min_y, max_y = min(y1, y2), max(y1, y2)

                        if min_x < max_x and min_y < max_y:
                            bboxes.append((min_x, min_y, max_x, max_y))

                    except (KeyError, TypeError, ValueError) as e:
                        erros.append(f"Erro na área {area.id} da construção {construcao.id}: {str(e)}")

                vertices = extrair_primeiro_poligono_puro(bboxes)

                if not vertices:
                    construcoes_ignoradas += 1
                    continue

                construcao.coordinates = vertices
                construcao.save(update_fields=["coordinates"])
                construcoes_atualizadas += 1

        return JsonResponse({
            "status": "concluido",
            "atualizadas": construcoes_atualizadas,
            "ignoradas": construcoes_ignoradas,
            "erros": erros,
        })
