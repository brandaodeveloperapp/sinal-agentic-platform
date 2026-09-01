FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

COPY pyproject.toml ./
COPY src ./src
RUN uv pip install --system --no-cache .

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin sinal
USER 10001

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8081/health').status==200 else 1)"

CMD ["uvicorn", "sinal_api.main:app", "--host", "0.0.0.0", "--port", "8081"]
