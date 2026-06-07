# backend/docker/Dockerfile — Development environment
# For production (Railway), see the Dockerfile at the repository root.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=catalyst.settings

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    tesseract-ocr \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

EXPOSE 8000

# Migrate at startup so the DB is always schema-current, then start
# Django's runserver with hot reload. Source code is bind-mounted at
# runtime via docker-compose so edits reflect immediately.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py createcachetable && python manage.py runserver 0.0.0.0:8000"]
