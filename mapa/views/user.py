from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core import signing
from mapa.forms.auth import LoginForm, RegisterForm
from django.contrib.auth.decorators import login_required

def logout(request):
    auth_logout(request)
    return redirect('/')

def login(request):
    loginForm = LoginForm()
    message = None
    if request.user.is_authenticated:
        return redirect('/')

    if request.method == 'POST':
        loginForm = LoginForm(request.POST)
        if loginForm.is_valid():
            email = loginForm.cleaned_data['email']
            password = loginForm.cleaned_data['password']
            user = authenticate(request, email=email, password=password)
            if user is not None:
                auth_login(request, user)
                return redirect('/')
            else:
                message = {'type': 'danger', 'text': 'Dados de usuário incorretos'}

    context = {
        'form': loginForm,
        'message': message,
        'title': 'Login',
        'button_text': 'Entrar',
        'link_text': 'Registrar',
        'link_href': '/register',
    }
    return render(request, template_name='login.html', context=context, status=200)


def register(request):
    registerForm = RegisterForm()
    message = None
    if request.user.is_authenticated:
        return redirect('/')

    if request.method == 'POST':
        registerForm = RegisterForm(request.POST)
        if registerForm.is_valid():
            username = registerForm.cleaned_data['username']
            email = registerForm.cleaned_data['email']
            password = registerForm.cleaned_data['password']

            if User.objects.filter(username__iexact=username).exists():
                message = {'type': 'danger', 'text': 'Já existe um usuário com este username!'}
            elif User.objects.filter(email__iexact=email).exists():
                message = {'type': 'danger', 'text': 'Já existe um usuário com este e-mail!'}
            else:
                try:
                    validate_password(password)
                except ValidationError as e:
                    registerForm.add_error('password', e)
                else:
                    user = User.objects.create_user(username=username, email=email, password=password)
                    auth_login(request, authenticate(request, email=email, password=password))
                    return redirect('/')

    context = {
        'form': registerForm,
        'message': message,
        'title': 'Registrar',
        'button_text': 'Registrar',
        'link_text': 'Login',
        'link_href': '/login',
    }
    return render(request, template_name='register.html', context=context, status=200)


@login_required
def generate_token_endpoint(request):
    """
    GET /api/share/generate/
    Generates a token for the currently logged-in user.
    """
    # Grab the ID of the user making the request
    user_id = request.user.id 
    
    # Create the secure signed token
    token = signing.dumps({'uid': user_id})
    
    return JsonResponse({
        'status': 'success',
        'token': token
    })


def resolve_token_endpoint(request):
    """
    GET /api/share/resolve/?token=eyJ1...
    Reads the token from the URL and validates it.
    """
    token = request.GET.get('token')
    
    if not token:
        return JsonResponse({'error': 'Missing token parameter'}, status=400)
        
    try:
        # Enforce the 30-day expiration (2592000 seconds)
        data = signing.loads(token, max_age=2592000)
        
        return JsonResponse({
            'status': 'success',
            'user_id': data['uid']
        })
        
    except signing.SignatureExpired:
        return JsonResponse({'error': 'This share link has expired.'}, status=410)
        
    except signing.BadSignature:
        return JsonResponse({'error': 'Invalid or tampered share link.'}, status=400)