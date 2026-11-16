FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE=instance/platform.sqlite3 \
    COOKIE_SECURE=1 \
    PDF_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
    PORT=10000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY platform_app ./platform_app
COPY migrations ./migrations
COPY templates ./templates
COPY static ./static

RUN mkdir -p /app/instance/uploads
EXPOSE 10000
CMD ["python", "-m", "platform_app.serve"]
