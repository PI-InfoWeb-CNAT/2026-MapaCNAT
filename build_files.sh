#!/bin/bash
uv pip install --system -r requirements.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput --clear