from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import HttpResponse, JsonResponse
from django.db import transaction
from django.template import loader
from typing import Any
import json
from ..models import *
from django.contrib.auth.decorators import login_required


@login_required
def mapa_editor(request: Any):
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render())

@login_required
@ensure_csrf_cookie
def mapa_editor_data(request: Any):
    
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            with transaction.atomic():
                Rota.objects.all().delete()
                Referencia.objects.all().delete()
                Construcao.objects.all().delete()
                ConstrucaoRegiao.objects.all().delete()
                id_to_db = {}

                references_data = data.get("references", {})
                ref_items = references_data.items() if isinstance(references_data, dict) else references_data
                
                for frontend_id, ref in ref_items:
                    ref_obj = Referencia.objects.create(
                        localizacao=ref.get("pos")
                    )
                    
                    if frontend_id is not None:
                        id_to_db[frontend_id] = ref_obj.id

                connections_data = data.get("connections")

                for conn in connections_data:
                    start_frontend_id = str(conn[0])
                    end_frontend_id = str(conn[1])

                    start_db_id = id_to_db.get(start_frontend_id)
                    end_db_id = id_to_db.get(end_frontend_id) if end_frontend_id else None

                    if start_db_id:
                        Rota.objects.create(
                            local_inicio=Referencia.objects.get(pk=start_db_id),
                            local_fim=Referencia.objects.get(pk=end_db_id),
                        )
                
                buildings_data = data.get("buildings")
                for build in buildings_data:
                    construcao = Construcao.objects.create(
                        nome=build.get("name", ""),
                        localizacao_pino=build.get("pin_pos", {"x": 0, "y": 0}),
                    )
                    areas = build.get("areas")
                    for area in areas:
                        ConstrucaoRegiao.objects.create(
                            posicao=area.get("pos"),
                            tamanho=area.get("size"),
                            construcao=construcao
                        )
                
            return JsonResponse({"status": "success"})
        except Exception as e:
            return JsonResponse({"status": "error", "message": str(e)}, status=400)

    elif request.method == "GET":
        return JsonResponse(export_db_to_json(), status=200)

    return JsonResponse({"status": "error", "message": "Invalid request method"}, status=405)

def export_db_to_json():
    references = {}
    db_to_frontend_id = {}
    
    for index, ref in enumerate(Referencia.objects.all()):
        frontend_id = str(index + 1)
        db_to_frontend_id[ref.id] = frontend_id
        
        references[frontend_id] = {
            "pos": ref.localizacao
        }

    connections = []
    for rota in Rota.objects.all():
        start_id = db_to_frontend_id.get(rota.local_inicio_id)
        end_id = db_to_frontend_id.get(rota.local_fim_id) if rota.local_fim_id else None
        
        if start_id:
            connections.append([start_id, end_id])

    buildings = []
    for build in Construcao.objects.all():
        areas_data = []
        for area in build.regiao.all():
            areas_data.append({
                "pos": area.posicao,
                "size": area.tamanho
            })
            
        buildings.append({
            "name": build.nome,
            "pin_pos": build.localizacao_pino,
            "areas": areas_data
        })

    payload = {
        "references": references,
        "connections": connections,
        "buildings": buildings
    }
    
    return payload