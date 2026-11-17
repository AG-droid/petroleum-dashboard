# Prahari: guide for AI agents working in this repo

Prahari is a proof of concept of a platform for an Indian oil company's **Sales Officer** to run the
petrol pumps (retail outlets) in one sales area (Gurugram). All data is **synthetic**. The repository
is **public**: never commit secrets, personal data, private plans (they live in the git-ignored
`private/` folder) or anything that imitates a real company's branding.

## Layout

| Path | What |
| --- | --- |
| `poc/` | The dashboard: static HTML/CSS/vanilla JS, MapLibre map, in-browser demo simulation |
| `poc/dealer/` | The dealer app, the same layout as the Sales Officer dashboard on the same synthetic world: map, Priorities, outlet panel, orders, payment, tracking; logic in `js/engine.js`, thresholds in `js/config.js`, checked by `tools/check_dealer.mjs` |
| `backend/` | Python 3.12 package `prahari`: FastAPI API, SQLAlchemy models, Alembic migrations, importers, rules engine, demo feed, CLI |
| `backend/src/prahari/ingest/formats.py` | The source-file layouts (modelled on OMC registers; not an official spec) |
| `backend/src/prahari/services/state.py` | The single place raw records become outlet state (stock, cover, variation …) |
| `backend/src/prahari/rules/engine.py` | Alert rules and their reconciliation with the `alert` table |
| `deploy/` | Docker Compose stack (TimescaleDB, migrate+seed, API, feed, Caddy) |
| `tools/` | Helper scripts (e.g. exporting the dashboard's synthetic world) |
| `docs/` | Research, planning, screenshots, pitch deck |

## Commands (from the repo root)

```bash
make up          # build and start the whole stack → http://localhost:8080
make check       # lint + type-check + tests (must pass before every commit)
make test        # backend tests (needs the db container: `make db`)
make demo-data   # regenerate today's sample data and import it
make logs        # follow the stack's logs
```

## Development workflow (every change)

1. **Branch**: work on a feature branch (`feature/...`, `fix/...`), never directly on `main`.
2. **Implement** in small steps. Keep the dashboard working at every step.
3. **Check**: `make check` must pass (ruff, mypy `--strict`, pytest against a real database).
4. **Review**: invoke the `code-reviewer` subagent on the change (e.g. "review `git diff --staged`" or
   "review commits `main..HEAD` touching `backend/src/prahari/ingest`"). It returns prioritised findings.
5. **Act on the review**: fix every `blocker` and `major`; fix `minor`/`nit` when cheap, or note why not.
   If you disagree with a finding, say why in the commit message or a code comment. Re-run `make check`.
6. **Commit locally**: one commit per feature or meaningful sub-step, conventional style
   (`feat(ingest): …`, `fix(rules): …`, `test: …`, `build: …`, `docs: …`), explaining *why*.
   **Do not push** unless the user asks.

## Conventions

- **Python**: type hints everywhere (mypy strict), docstrings on modules and public functions that
  explain *why* and the domain context, not just *what*. Comments for non-obvious decisions.
- **Time**: always timezone-aware datetimes; business days run from the morning dip (06:00 IST by
  default), see `prahari.domain.time`. Never use naive `datetime.now()`.
- **Units**: litres (`_l`) and kilolitres (`_kl`) are suffixed in names; mm for dips; kg/m³ for density.
- **Vocabulary**: outlets are keyed by their 6-digit **RO code** (demo codes are 9901xx; never use
  real ones). Hierarchy is State Office → Divisional Office → Retail Sales Area; write "Sales
  Officer" in full ("SO" means State Office). Class of market: A/B/C-Urban, D1/D2-Highway, E-Rural.
  Product codes stay brand-neutral; oil-company labels (XP95, XG …) are import aliases only.
- **Data in**: every source goes through a validating importer or a typed payload; imports are
  idempotent upserts on natural keys and recorded as `ImportJob`s with per-row errors.
- **Database changes**: change the models, then `uv run alembic -c src/prahari/alembic.ini revision
  --autogenerate -m "..."`, review the migration by hand, and keep `alembic check` clean.
- **Thresholds** live in `prahari.config.RuleThresholds`, never as magic numbers in rules.
- **Actions** create records (requests, holds, acknowledgements) and an `AuditLog` entry; they never
  silently change history.
- **Dashboard**: plain JS, no build step. Escape anything from the API before putting it in HTML.
  The dashboard must keep working with no backend (offline demo mode).
- **Tests**: new behaviour comes with tests. Database tests use the seeded template fixtures in
  `backend/tests/conftest.py`.
