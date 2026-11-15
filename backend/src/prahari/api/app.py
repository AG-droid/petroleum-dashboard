"""FastAPI application factory and the background rules scheduler."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from prahari import __version__
from prahari.api.routers import core, ingest
from prahari.config import Settings, get_settings
from prahari.db.session import session_scope
from prahari.domain.time import now_utc
from prahari.logconfig import configure_logging
from prahari.rules.engine import run_rules

log = logging.getLogger(__name__)


async def _rules_loop(app: FastAPI, settings: Settings) -> None:
    """Re-evaluate alerts on a fixed interval. Failures are logged and retried next tick."""
    while True:
        try:
            await asyncio.to_thread(_run_once, settings)
            app.state.last_rules_run = now_utc()
        except Exception:
            log.exception("scheduled rules run failed")
        await asyncio.sleep(settings.rules_interval_seconds)


def _run_once(settings: Settings) -> None:
    with session_scope() as session:
        run_rules(session, settings)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.last_rules_run = None
        task = asyncio.create_task(_rules_loop(app, settings)) if settings.run_scheduler else None
        log.info("prahari api started", extra={"version": __version__, "env": settings.env})
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="Prahari API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        description="Ingestion, state and alerts for a sales area's retail outlets. Synthetic demo data.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Prahari-User"],
    )
    app.include_router(core.router, prefix="/api/v1")
    app.include_router(ingest.router, prefix="/api/v1")

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Log the details server-side; never leak stack traces to clients.
        log.exception("unhandled error", extra={"path": request.url.path})
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

    return app
