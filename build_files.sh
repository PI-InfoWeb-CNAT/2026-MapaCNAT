#!/bin/bash

uv pip install --system .

python manage.py migrate --noinput

python manage.py collectstatic --noinput --clear