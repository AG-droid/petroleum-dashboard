"""Import files end to end: detect the format, validate, load, and record an :class:`ImportJob`.

Each file loads inside a savepoint: if anything unexpected fails, that file's data is rolled back
but its ImportJob (with the error) is still recorded.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from prahari.config import Settings
from prahari.domain.time import now_utc
from prahari.ingest import importers
from prahari.ingest.formats import FileKind
from prahari.ingest.importers import IMPORT_ORDER, ImportResult, RowError
from prahari.ingest.reader import Table, UnreadableFileError, read_table
from prahari.models import ImportJob

log = logging.getLogger(__name__)
MAX_STORED_ERRORS = 200
SUPPORTED_SUFFIXES = {".xlsx", ".csv", ".json"}
NOT_IMPORTABLE = {"feed_state.json"}  # generator output used by the live feed, not a source file


@dataclass
class _Parsed:
    path: Path
    kind: FileKind | None
    table: Table | None
    error: str | None = None


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse(path: Path) -> _Parsed:
    if path.suffix.lower() == ".json":
        try:
            kind = json.loads(path.read_text(encoding="utf-8")).get("kind")
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError) as exc:
            return _Parsed(path, None, None, f"invalid JSON: {exc}")
        if kind != FileKind.SALES_AREA.value:
            return _Parsed(path, None, None, "JSON files must be a sales-area profile (kind: sales_area)")
        return _Parsed(path, FileKind.SALES_AREA, None)
    try:
        table = read_table(path)
    except UnreadableFileError as exc:
        return _Parsed(path, None, None, str(exc))
    return _Parsed(path, table.kind, table)


def _load(session: Session, parsed: _Parsed, settings: Settings) -> ImportResult:
    kind, table = parsed.kind, parsed.table
    if kind is FileKind.SALES_AREA:
        return importers.import_sales_area(session, parsed.path)
    assert table is not None
    tz = settings.tz
    match kind:
        case FileKind.RO_MASTER:
            return importers.import_ro_master(session, table)
        case FileKind.TANK_MASTER:
            return importers.import_tank_master(session, table)
        case FileKind.NOZZLE_MASTER:
            return importers.import_nozzle_master(session, table)
        case FileKind.LICENCE_REGISTER:
            return importers.import_licences(session, table)
        case FileKind.TT_RECEIPTS:
            return importers.import_receipts(session, table, tz)
        case FileKind.INDENT_STATUS:
            return importers.import_indents(session, table)
        case FileKind.DSR:
            return importers.import_dsr(session, table)
        case FileKind.DIP_REGISTER:
            return importers.import_dips(session, table, tz)
    raise AssertionError(f"no importer for {kind}")


def import_file(
    session: Session,
    path: Path,
    settings: Settings,
    *,
    submitted_by: str = "system",
    display_name: str | None = None,
    force: bool = False,
    parsed: _Parsed | None = None,
) -> ImportJob:
    """Import one file and return its (flushed, not committed) :class:`ImportJob`."""
    digest = _sha256(path)
    job = ImportJob(
        filename=display_name or path.name,
        sha256=digest,
        submitted_by=submitted_by,
        kind="unknown",
        status="failed",
        started_at=now_utc(),
    )
    session.add(job)

    parsed = parsed or _parse(path)
    if parsed.kind is None:
        job.errors = [RowError(0, None, parsed.error or "unrecognised file").as_dict()]
        job.finished_at = now_utc()
        session.flush()
        return job
    job.kind = parsed.kind.value

    already = session.scalar(
        select(ImportJob.id).where(ImportJob.sha256 == digest, ImportJob.status == "succeeded").limit(1)
    )
    if already and not force:
        job.status, job.finished_at = "skipped", now_utc()
        job.errors = [
            {"row": 0, "column": None, "message": f"identical file already imported (job {already})"}
        ]
        session.flush()
        return job

    try:
        with session.begin_nested():
            result = _load(session, parsed, settings)
    except Exception as exc:  # unexpected (e.g. database) error: keep the job, drop the file's data
        log.exception("import failed", extra={"file": job.filename})
        result = ImportResult(errors=[RowError(0, None, f"internal error: {type(exc).__name__}")])

    job.rows_total, job.rows_accepted = result.total, result.accepted
    job.rows_rejected = len(result.errors)
    job.errors = [e.as_dict() for e in result.errors[:MAX_STORED_ERRORS]] or None
    job.status = "succeeded" if not result.errors else ("partial" if result.accepted else "failed")
    job.finished_at = now_utc()
    session.flush()
    log.info(
        "imported %s",
        job.filename,
        extra={
            "kind": job.kind,
            "status": job.status,
            "accepted": job.rows_accepted,
            "rejected": job.rows_rejected,
        },
    )
    return job


def import_paths(
    session: Session,
    paths: list[Path],
    settings: Settings,
    *,
    force: bool = False,
    submitted_by: str = "system",
) -> list[ImportJob]:
    """Import many files (directories are expanded), masters first, committing after each file."""
    files: list[Path] = []
    for p in paths:
        if p.is_dir():
            files += [f for f in sorted(p.rglob("*")) if f.is_file()]
        else:
            files.append(p)
    files = [f for f in files if f.suffix.lower() in SUPPORTED_SUFFIXES and f.name not in NOT_IMPORTABLE]
    parsed = [_parse(f) for f in files]
    order = {k: i for i, k in enumerate(IMPORT_ORDER)}
    parsed.sort(key=lambda x: (order.get(x.kind, len(order)) if x.kind else len(order), x.path.name))
    jobs = []
    for item in parsed:
        jobs.append(
            import_file(session, item.path, settings, force=force, parsed=item, submitted_by=submitted_by)
        )
        session.commit()
    return jobs
