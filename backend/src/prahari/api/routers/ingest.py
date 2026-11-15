"""Getting data in over HTTP: file uploads and the live automation feed."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlalchemy import select

from prahari.api import schemas
from prahari.api.deps import ActorDep, SessionDep, SettingsDep
from prahari.ingest.automation import AutomationBatch, BatchResult, store_batch
from prahari.ingest.pipeline import SUPPORTED_SUFFIXES, import_file
from prahari.models import ImportJob
from prahari.rules.engine import run_rules

router = APIRouter()


@router.get("/imports", response_model=list[schemas.ImportJobOut], tags=["imports"])
def list_imports(session: SessionDep, limit: int = Query(50, ge=1, le=500)) -> list[schemas.ImportJobOut]:
    jobs = session.scalars(select(ImportJob).order_by(ImportJob.id.desc()).limit(limit))
    return [schemas.ImportJobOut.model_validate(j) for j in jobs]


@router.get("/imports/{job_id}", response_model=schemas.ImportJobOut, tags=["imports"])
def get_import(job_id: int, session: SessionDep) -> schemas.ImportJobOut:
    job = session.get(ImportJob, job_id)
    if job is None:
        raise HTTPException(404, f"import {job_id} not found")
    return schemas.ImportJobOut.model_validate(job)


@router.post("/imports", response_model=schemas.ImportJobOut, status_code=201, tags=["imports"])
def upload(
    file: UploadFile,
    session: SessionDep,
    settings: SettingsDep,
    actor: ActorDep,
    force: bool = Query(False, description="Re-import even if this exact file was loaded before."),
) -> schemas.ImportJobOut:
    """Upload one export (.xlsx, .csv or the sales-area .json). The format is detected from its header.

    Returns 201 with the import job whenever the file was processed, **including** when rows or the
    whole file were rejected or it was skipped as a duplicate: check ``status`` (succeeded |
    partial | failed | skipped) and ``errors``. Wrong type → 415, too large → 413.
    """
    name = Path(file.filename or "upload").name  # never trust a client path
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise HTTPException(415, f"unsupported file type {suffix!r}; use .xlsx, .csv or .json")
    limit = settings.max_upload_mb * 1024 * 1024
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        size = 0
        with path.open("wb") as fh:
            # Sync handler: FastAPI runs it in a worker thread, so parsing never blocks the event loop.
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"file larger than {settings.max_upload_mb} MB")
                fh.write(chunk)
        job = import_file(session, path, settings, submitted_by=actor, display_name=name, force=force)
    if job.rows_accepted:
        run_rules(session, settings, wait=True)
    return schemas.ImportJobOut.model_validate(job)


@router.post("/ingest/automation", response_model=BatchResult, tags=["ingest"])
def ingest_automation(batch: AutomationBatch, session: SessionDep, _actor: ActorDep) -> BatchResult:
    """Tank-gauge levels and pump totalisers from outlet automation (see ``prahari.ingest.automation``).

    Rules are not re-run per batch; the scheduler picks the new readings up within a minute.
    """
    return store_batch(session, batch)
