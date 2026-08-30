from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import HttpResponse, JsonResponse
from django.db import transaction
from django.template import loader
from typing import Any
import json
from ..models import *

def mapa_editor(request: Any):
    template = loader.get_template('mapa-editor.html')
    return HttpResponse(template.render())

@ensure_csrf_cookie
def mapa_editor_save(request: Any):
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

    return JsonResponse({"status": "error", "message": "Invalid request method"}, status=405)