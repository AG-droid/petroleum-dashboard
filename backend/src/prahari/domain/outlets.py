"""How the oil company identifies and classifies retail outlets.

Vocabulary is modelled on oil-company MIS conventions (not an official specification):

- **RO code**: every retail outlet (RO) has a 6-digit numeric code. It is the key that SAP
  invoices, automation data and every MIS report use, so it is Prahari's outlet key too.
- **Sales hierarchy**: State Office (SO) → Divisional Office (DO) → Retail Sales Area (RSA).
  A field Sales Officer looks after one RSA. ("SO" means State Office in this vocabulary, so the
  Sales Officer role is always written out in full.)
- **Class of market**: A/B/C-Urban, D1/D2-Highway, E-Rural; it drives targets and comparisons.

The synthetic demo world uses RO codes in the 9901xx range, kept apart from real outlet codes so
generated alerts can never be read as describing a real outlet.
"""

from __future__ import annotations

import re

RO_CODE_DIGITS = 6
_RO_CODE = re.compile(rf"^\d{{{RO_CODE_DIGITS}}}$")

# Canonical spelling → broad category used for demand profiles and simple grouping.
MARKET_CLASSES: dict[str, str] = {
    "A-Urban": "Urban",
    "B-Urban": "Urban",
    "C-Urban": "Urban",
    "D1-Highway": "Highway",
    "D2-Highway": "Highway",
    "E-Rural": "Rural",
}
_MARKET_KEYS = {k.upper().replace("-", ""): k for k in MARKET_CLASSES}


def normalise_ro_code(raw: str) -> str:
    """Return the RO code if it is exactly six digits, else raise ``ValueError``."""
    code = str(raw).strip()
    if not _RO_CODE.match(code):
        raise ValueError(f"{code!r} is not a {RO_CODE_DIGITS}-digit RO code")
    return code


def normalise_market_class(raw: str) -> str:
    """Map "D1 Highway", "d1-highway", "E RURAL" … to the canonical class, or raise ``ValueError``."""
    key = re.sub(r"[\s_\-]+", "", str(raw)).upper()
    try:
        return _MARKET_KEYS[key]
    except KeyError:
        valid = ", ".join(MARKET_CLASSES)
        raise ValueError(f"{raw!r} is not a class of market ({valid})") from None


def market_category(market_class: str) -> str:
    """Highway, Urban or Rural for a canonical class of market."""
    return MARKET_CLASSES[market_class]
