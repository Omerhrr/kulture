# Kaduna Kulture backend (FastAPI + Alembic). One process on purpose: live
# multiplayer state (presence, rides, races) is held in memory.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

RUN useradd --create-home --uid 10001 kk && chown -R kk /app
USER kk

EXPOSE 8000
# migrations run inside the app at startup (app/db/migrate.py)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-keep-alive", "75"]
