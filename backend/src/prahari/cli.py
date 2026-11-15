"""Command-line entry point: ``prahari <command>``. Run ``prahari --help`` for the list."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from prahari.config import get_settings
from prahari.logconfig import configure_logging

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger("prahari")
DEFAULT_SAMPLES = Path("sample-data")


def _db_upgrade(_: argparse.Namespace) -> int:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).with_name("alembic.ini")))  # ships inside the package
    command.upgrade(cfg, "head")
    return 0


def _generate(args: argparse.Namespace) -> int:
    from prahari.samples.generator import generate

    s = get_settings()
    as_of = datetime.fromisoformat(args.as_of) if args.as_of else datetime.now(UTC)
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=s.tz)
    files = generate(
        Path(args.out), as_of=as_of, tz=s.tz, start_hour=s.business_day_start_hour, days=args.days
    )
    log.info("wrote %d sample files to %s", len(files), args.out)
    return 0


def _import(args: argparse.Namespace) -> int:
    from prahari.db.session import session_scope
    from prahari.ingest.pipeline import import_paths
    from prahari.rules.engine import run_rules

    s = get_settings()
    with session_scope() as session:
        jobs = import_paths(session, [Path(p) for p in args.paths], s, force=args.force, submitted_by="cli")
        summary = run_rules(session, s)
    bad = [j for j in jobs if j.status in {"failed", "partial"}]
    for j in jobs:
        print(f"{j.status:9} {j.kind:16} {j.filename:40} {j.rows_accepted:6} ok {j.rows_rejected:4} rejected")
        for e in (j.errors or [])[:5] if j.status != "skipped" else []:
            print(f"          row {e['row']}: {e['message']}")
    print(f"alerts: {summary.opened} opened, {summary.updated} updated, {summary.resolved} resolved")
    return 1 if bad else 0


def _rules(_: argparse.Namespace) -> int:
    from prahari.db.session import session_scope
    from prahari.rules.engine import run_rules

    with session_scope() as session:
        summary = run_rules(session, get_settings())
    print(f"alerts: {summary.opened} opened, {summary.updated} updated, {summary.resolved} resolved")
    return 0


def _pre_ro_code_outlets(session: Session) -> str | None:
    """The first outlet whose code is not a 6-digit RO code (demo data from an older version)."""
    from sqlalchemy import select

    from prahari.domain.outlets import normalise_ro_code
    from prahari.models import Outlet

    for code in session.scalars(select(Outlet.code)):
        try:
            normalise_ro_code(code)
        except ValueError:
            return code
    return None


def _seed_demo(args: argparse.Namespace) -> int:
    """Generate today's sample files and import them: the one-step demo setup.

    On a new business day the previous day's generated history is cleared first (see
    ``prahari.samples.reset``) and every file is re-imported.
    """
    from datetime import timedelta

    from prahari.db.session import session_scope
    from prahari.domain.time import business_date
    from prahari.samples.reset import start_new_demo_day_if_needed

    s = get_settings()
    with session_scope() as session:
        if stale := _pre_ro_code_outlets(session):
            log.error(
                "the database holds outlets from before RO codes (e.g. %s); demo data can't be "
                "merged into it. Run `make reset` to start again with RO codes.",
                stale,
            )
            return 1
    args.as_of, args.paths = None, [args.out]
    if rc := _generate(args):
        return rc
    yesterday = business_date(datetime.now(UTC), s.tz, s.business_day_start_hour) - timedelta(days=1)
    with session_scope() as session:
        args.force = start_new_demo_day_if_needed(session, yesterday)
    return _import(args)


def _feed(args: argparse.Namespace) -> int:
    from prahari.feed import StaleStateError, run

    try:
        run(args.api, Path(args.state), tz=get_settings().tz, interval=args.interval, once=args.once)
    except StaleStateError as exc:
        log.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        pass
    return 0


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("prahari.api.app:create_app", factory=True, host=args.host, port=args.port, log_config=None)
    return 0


def main(argv: list[str] | None = None) -> int:
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    p = argparse.ArgumentParser(prog="prahari", description="Prahari backend tools")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("db-upgrade", help="apply database migrations").set_defaults(fn=_db_upgrade)

    g = sub.add_parser("generate-samples", help="write a month of synthetic OMC-style source files")
    g.add_argument("--out", default=str(DEFAULT_SAMPLES))
    g.add_argument("--as-of", help="ISO timestamp to generate for (default: now)")
    g.add_argument("--days", type=int, default=30)
    g.set_defaults(fn=_generate)

    i = sub.add_parser("import", help="import files or folders of exports")
    i.add_argument("paths", nargs="+")
    i.add_argument("--force", action="store_true", help="re-import files already loaded")
    i.set_defaults(fn=_import)

    sub.add_parser("rules", help="run the alert rules once").set_defaults(fn=_rules)

    d = sub.add_parser("seed-demo", help="generate today's sample files and import them")
    d.add_argument("--out", default=str(DEFAULT_SAMPLES))
    d.add_argument("--days", type=int, default=30)
    d.set_defaults(fn=_seed_demo)

    f = sub.add_parser("feed", help="post live automation readings to the API (demo)")
    f.add_argument("--api", default="http://localhost:8000")
    f.add_argument("--state", default=str(DEFAULT_SAMPLES / "feed_state.json"))
    f.add_argument("--interval", type=float, default=60)
    f.add_argument("--once", action="store_true")
    f.set_defaults(fn=_feed)

    v = sub.add_parser("serve", help="run the API server")
    v.add_argument("--host", default="127.0.0.1")
    v.add_argument("--port", type=int, default=8000)
    v.set_defaults(fn=_serve)

    args = p.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())
