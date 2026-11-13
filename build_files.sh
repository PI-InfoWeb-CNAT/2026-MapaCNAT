#!/bin/bash

uv python install 3.12
uv venv --python 3.12 .venv
source .venv/bin/activate

uv pip install .

python manage.py migrate --noinput

python manage.py collectstatic --noinput --clear