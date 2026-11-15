"""Read Excel and CSV exports into rows keyed by column name.

MIS exports often start with a title block, so the header is located by scanning the first rows
for a line that matches a known format, rather than assuming row 1.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from prahari.ingest.formats import FileKind, detect_kind

HEADER_SCAN_ROWS = 12


class UnreadableFileError(ValueError):
    """The file could not be parsed or does not match any known format."""


@dataclass
class Table:
    kind: FileKind
    rows: list[tuple[int, dict[str, Any]]]  # (1-based row number in the file, values by column)


def _norm(cell: Any) -> str:
    return str(cell).strip().upper().replace(" ", "_") if cell is not None else ""


def _locate(lines: Iterable[list[Any]]) -> tuple[FileKind, list[str], Iterator[tuple[int, list[Any]]]]:
    it = iter(enumerate(lines, start=1))
    for row_no, line in it:
        header = [_norm(c) for c in line]
        kind = detect_kind(set(header))
        if kind:
            return kind, header, it
        if row_no >= HEADER_SCAN_ROWS:
            break
    raise UnreadableFileError("no recognised header row in the first rows; is this a supported export?")


def _collect(kind: FileKind, header: list[str], body: Iterator[tuple[int, list[Any]]]) -> Table:
    rows = []
    for row_no, line in body:
        if all(c is None or str(c).strip() == "" for c in line):
            continue  # blank lines and trailing empty rows
        rows.append((row_no, {h: (line[i] if i < len(line) else None) for i, h in enumerate(header) if h}))
    return Table(kind, rows)


def read_table(path: Path) -> Table:
    """Parse an ``.xlsx`` or ``.csv`` file into a :class:`Table`."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".xlsx":
            wb = load_workbook(path, read_only=True, data_only=True)
            try:
                ws = wb.worksheets[0]
                lines = (list(r) for r in ws.iter_rows(values_only=True))
                kind, header, body = _locate(lines)
                return _collect(kind, header, body)
            finally:
                wb.close()
        if suffix == ".csv":
            with path.open(newline="", encoding="utf-8-sig") as fh:
                kind, header, body = _locate(csv.reader(fh))
                return _collect(kind, header, body)
    except UnreadableFileError:
        raise
    except Exception as exc:  # corrupt workbook, bad encoding, ...
        raise UnreadableFileError(f"could not read {path.name}: {exc}") from exc
    raise UnreadableFileError(f"unsupported file type {suffix!r} (use .xlsx or .csv)")
