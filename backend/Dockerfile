# syntax=docker/dockerfile:1.7
# Prahari backend image: API, CLI tools and the demo automation feed.

FROM ghcr.io/astral-sh/uv:0.13.8 AS uv

FROM python:3.12-slim-bookworm AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# Dependencies first (cached unless the lockfile changes), then the project itself.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim-bookworm
# /data/samples must exist (owned by the app user) so a new named volume inherits that ownership.
RUN useradd --system --uid 10001 --home-dir /app prahari && mkdir -p /data/samples && chown -R prahari /data
WORKDIR /app
COPY --from=build --chown=prahari /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 PRAHARI_LOG_JSON=true
USER prahari
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"
# `prahari serve` runs uvicorn with our logging setup (JSON lines in containers).
CMD ["prahari", "serve", "--host", "0.0.0.0", "--port", "8000"]
