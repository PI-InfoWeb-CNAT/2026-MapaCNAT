from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from mapa.forms.auth import LoginForm, RegisterForm

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