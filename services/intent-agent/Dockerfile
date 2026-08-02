FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY services/intent-agent/pyproject.toml ./
COPY services/intent-agent/app app
RUN pip install --no-cache-dir '.[vertex]'
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
