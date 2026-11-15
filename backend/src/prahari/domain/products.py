"""Product codes and the aliases different source systems use for them.

Exports name the same fuel in different ways ("MS", "Petrol", "PMS", "Diesel", "HSD"). Every
importer normalises through :func:`normalise_product` so the rest of the system sees one code.
"""

from __future__ import annotations

MS = "MS"  # Motor Spirit (petrol)
HSD = "HSD"  # High Speed Diesel
XP = "XP"  # premium petrol (brand-neutral)

PRODUCT_NAMES = {MS: "Petrol", HSD: "Diesel", XP: "Premium Petrol"}

_ALIASES = {
    "MS": MS,
    "PETROL": MS,
    "MOTOR SPIRIT": MS,
    "HSD": HSD,
    "DIESEL": HSD,
    "HIGH SPEED DIESEL": HSD,
    "XP": XP,
    "PMS": XP,
    "PREMIUM MS": XP,
    "PREMIUM PETROL": XP,
}


def normalise_product(raw: str) -> str:
    """Map a source system's product label to our code; raises ``ValueError`` if unknown."""
    key = " ".join(str(raw).upper().replace("-", " ").replace("_", " ").split())
    try:
        return _ALIASES[key]
    except KeyError:
        raise ValueError(f"unknown product {raw!r}") from None
