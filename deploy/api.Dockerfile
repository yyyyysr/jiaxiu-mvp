FROM ghcr.io/astral-sh/uv:0.11.26-python3.12-trixie-slim

ENV UV_PROJECT_ENVIRONMENT=/opt/jiaxiu-venv \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/workspace/apps/api \
    PATH=/opt/jiaxiu-venv/bin:$PATH

WORKDIR /workspace

COPY apps/api/pyproject.toml apps/api/uv.lock /workspace/apps/api/
RUN uv sync --frozen --no-dev --no-install-project --project /workspace/apps/api

COPY apps/api/app /workspace/apps/api/app
COPY data/jiaxiu_tiyong.sqlite /workspace/data/jiaxiu_tiyong.sqlite
COPY deploy/api-entrypoint.sh /usr/local/bin/jiaxiu-entrypoint

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin jiaxiu \
    && mkdir -p /var/lib/jiaxiu/app /var/lib/jiaxiu/submissions /var/lib/jiaxiu/facsimiles \
    && chown -R jiaxiu:jiaxiu /var/lib/jiaxiu \
    && chmod 0555 /usr/local/bin/jiaxiu-entrypoint

USER jiaxiu
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2).read()"

ENTRYPOINT ["/usr/local/bin/jiaxiu-entrypoint"]
