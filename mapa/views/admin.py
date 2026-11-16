from django.http import HttpResponse
from django.template import loader
from typing import Any
from ..models import *
from ..forms.staff import AdicionarStaffForm, RemoverStaffForm
from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth import get_user_model
from django.contrib import messages
from ..forms.admin import NovoMapaForm
from ..models.mapa import Mapa
from django.http import HttpResponse, Http404
from django.db import IntegrityError
from django.views.decorators.http import require_POST
from django.db.models.functions import Length

User = get_user_model()

def mapa_svg_raw(request, mapa_id):
    mapa = get_object_or_404(Mapa, pk=mapa_id)
    if not mapa.svg_blob:
        raise Http404("SVG does not exist")

    return HttpResponse(
        bytes(mapa.svg_blob),
        content_type='image/svg+xml'
    )

def _nao_encontrado():
    return HttpResponse(loader.get_template('404.html').render())


def staff_ou_404(view):
    """Mesmo comportamento da sua admin_view: não-staff vê a 404."""
    def envolta(request, *args, **kwargs):
        if not request.user.is_staff:
            return _nao_encontrado()
        return view(request, *args, **kwargs)
    return envolta


def _mapas_leves():
    """Listagem sem carregar o svg_blob (até 20 MB por mapa) de cada linha."""
    return Mapa.objects.defer('svg_blob').annotate(svg_tamanho=Length('svg_blob'))


def admin_view(request):
    if not request.user.is_staff:
        return _nao_encontrado()

    form = NovoMapaForm()

    if request.method == 'POST':
        form = NovoMapaForm(request.POST, request.FILES)
        if form.is_valid():
            try:
                Mapa.objects.create(
                    nome=form.cleaned_data['nome'],
                    svg_blob=form.svg_bytes,
                    coordinates=form.cleaned_data['coordinates'],
                )
                messages.success(request, 'Mapa cadastrado com sucesso.')
                return redirect('painel_hub')
            except IntegrityError:
                form.add_error('nome', 'Já existe um mapa cadastrado com este nome.')

    mapas = _mapas_leves()

    busca = request.GET.get('nome')
    visibilidade = request.GET.get('estado')

    if busca:
        mapas = mapas.filter(nome__icontains=busca.strip())

    if visibilidade == 'publico':
        mapas = mapas.filter(public='publico')
    elif visibilidade == 'privado':
        mapas = mapas.filter(public='privado')
    elif visibilidade == 'manutencao':
        mapas = mapas.filter(public='manutencao')

    return render(request, 'painel/hub.html', {
        'mapas': mapas.order_by('-pk'),
        'form': form,
    })


@staff_ou_404
@require_POST
def mapa_editar(request, pk):
    mapa = get_object_or_404(Mapa, pk=pk)
    form = NovoMapaForm(request.POST, request.FILES, mapa=mapa)

    if not form.is_valid():
        erros = ' '.join(e for lista in form.errors.values() for e in lista)
        messages.error(request, f'Não foi possível salvar: {erros}')
        return redirect('painel_hub')

    mapa.nome = form.cleaned_data['nome']
    mapa.coordinates = form.cleaned_data['coordinates']
    if form.svg_bytes is not None:           # só troca o SVG se um novo foi enviado
        mapa.svg_blob = form.svg_bytes

    # um mapa público que deixou de estar completo volta a ser privado
    if mapa.public and not mapa.configuracao_completa:
        mapa.public = False
        messages.warning(request, 'A configuração ficou incompleta; o mapa voltou a ser privado.')

    try:
        mapa.save()
    except IntegrityError:
        messages.error(request, 'Já existe um mapa cadastrado com este nome.')
        return redirect('painel_hub')

    messages.success(request, 'Mapa atualizado.')
    return redirect('painel_hub')


@staff_ou_404
@require_POST
def mapa_apagar(request, pk):
    mapa = get_object_or_404(Mapa.objects.only('pk', 'nome'), pk=pk)
    nome = mapa.nome
    mapa.delete()
    messages.success(request, f'Mapa “{nome}” apagado.')
    return redirect('painel_hub')


@staff_ou_404
@require_POST
def mapa_publicar(request, pk):
    mapa = get_object_or_404(_mapas_leves().only('pk', 'nome', 'public', 'coordinates'), pk=pk)

    estado = request.POST.get('estado')

    if estado not in ['publico', 'privado', 'manutencao']:
        messages.error(request, 'Estado inválido.')
    elif estado == 'publico' and not mapa:
        messages.error(request, 'Envie o SVG e marque os 3 pontos antes de publicar.')
    else:
        mapa.public = estado
        mapa.save(update_fields=['public'])
        messages.success(request, f'Mapa modificado "{mapa.nome}"')
        
    mapa.save(update_fields=['public'])
    return redirect('painel_hub')

def admin_staff(request):
    if not request.user.is_staff:
        template = loader.get_template('404.html')
        return HttpResponse(template.render())

    add_form = AdicionarStaffForm()
    remove_form = RemoverStaffForm()

    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'add':
            add_form = AdicionarStaffForm(request.POST)
            if add_form.is_valid():
                usuario = add_form.usuario_encontrado
                usuario.is_staff = True
                usuario.save(update_fields=['is_staff'])

                messages.success(request, f'{usuario.email} agora tem acesso de staff.')
                return redirect('painel_staff')

        elif action == 'remove':
            remove_form = RemoverStaffForm(request.POST)
            if remove_form.is_valid():
                user_id = remove_form.cleaned_data['user_id']
                usuario = get_object_or_404(User, pk=user_id)

                if usuario == request.user:
                    messages.error(request, 'Você não pode remover sua própria permissão de staff.')
                else:
                    usuario.is_staff = False
                    usuario.save(update_fields=['is_staff'])
                    messages.success(request, f'Acesso de staff removido de {usuario.email}.')

                return redirect('painel_staff')

    staff_users = User.objects.filter(is_staff=True).select_related('profile').order_by('first_name', 'email')

    context = {
        'form': add_form,
        'remove_form': remove_form,
        'staff_users': staff_users,
    }
    return render(request, 'painel/staff.html', context)