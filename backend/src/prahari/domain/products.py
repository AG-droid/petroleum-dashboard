"""Product codes and the aliases different source systems use for them.

Exports name the same fuel in different ways ("MS", "Petrol", "MS-R", "Diesel", "HSD"). Every
importer normalises through :func:`normalise_product` so the rest of the system sees one code.

Internal codes and names are brand-neutral. Brand labels found in MIS exports (such as XP95,
XP100, XG) are accepted as aliases so those exports import unchanged, but never shown as our own.
"""

from __future__ import annotations

MS = "MS"  # Motor Spirit (petrol)
HSD = "HSD"  # High Speed Diesel
XP = "XP"  # premium petrol, 95 octane
P100 = "P100"  # premium petrol, 100 octane
PD = "PD"  # premium diesel
E85 = "E85"  # ethanol blend, 85 %
E100 = "E100"  # ethanol, 100 %
CNG = "CNG"  # compressed natural gas
CBG = "CBG"  # compressed bio-gas

PRODUCT_NAMES = {
    MS: "Petrol",
    HSD: "Diesel",
    XP: "Premium Petrol",
    P100: "Premium Petrol 100",
    PD: "Premium Diesel",
    E85: "Ethanol E85",
    E100: "Ethanol E100",
    CNG: "CNG",
    CBG: "Compressed Bio-Gas",
}

# Gases are sold by weight; everything else by volume. Tanks, dips and density checks only
# apply to liquid products.
UNIT_KG = "kg"
UNIT_L = "L"
PRODUCT_UNITS = {code: (UNIT_KG if code in (CNG, CBG) else UNIT_L) for code in PRODUCT_NAMES}

_ALIASES = {
    "MS": MS,
    "MS R": MS,  # "-R" = retail, as in oil-company MIS ("MS-R", "HSD-R")
    "PETROL": MS,
    "MOTOR SPIRIT": MS,
    "HSD": HSD,
    "HSD R": HSD,
    "DIESEL": HSD,
    "HIGH SPEED DIESEL": HSD,
    "XP": XP,
    "XP95": XP,
    "PMS": XP,
    "PREMIUM MS": XP,
    "PREMIUM PETROL": XP,
    "P100": P100,
    "XP100": P100,
    "PREMIUM PETROL 100": P100,
    "PD": PD,
    "XG": PD,
    "PREMIUM DIESEL": PD,
    "PREMIUM HSD": PD,
    "E85": E85,
    "E100": E100,
    "CNG": CNG,
    "CBG": CBG,
}


def normalise_product(raw: str) -> str:
    """Map a source system's product label to our code; raises ``ValueError`` if unknown."""
    key = " ".join(str(raw).upper().replace("-", " ").replace("_", " ").split())
    try:
        return _ALIASES[key]
    except KeyError:
        raise ValueError(f"unknown product {raw!r}") from None
