FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-impress libreoffice-calc poppler-utils \
      fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY frontend /srv/frontend
RUN useradd -m -u 10001 konvertin && mkdir -p /data && chown konvertin /data
USER konvertin
ENV KONVERTIN_DATA_DIR=/data KONVERTIN_FRONTEND_DIR=/srv/frontend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
