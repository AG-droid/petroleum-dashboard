"""Dip-to-volume calibration for horizontal cylindrical underground tanks.

Dealers measure stock by lowering a graduated dip rod into the tank. The product height (dip) is
converted to litres with the tank's calibration chart. Real charts are certified per tank; here we
derive the chart from the tank's geometry, which is what such charts approximate:

    V(h) = L * (R² · acos((R - h) / R) - (R - h) · sqrt(2Rh - h²))

for a horizontal cylinder of radius R and length L filled to height h. (Real tanks have domed
ends, which add a little volume; ignored here.)
"""

from __future__ import annotations

import math

# Typical diameters of Indian underground petroleum tanks by nominal capacity (kL → mm).
_STANDARD_DIAMETERS_MM: tuple[tuple[float, float], ...] = (
    (10, 2000),
    (15, 2200),
    (20, 2500),
    (25, 2700),
    (30, 2900),
    (35, 3000),
)


def standard_dimensions(capacity_kl: float) -> tuple[float, float]:
    """Return ``(diameter_mm, length_mm)`` for a tank of the given nominal capacity."""
    if capacity_kl <= 0:
        raise ValueError("capacity must be positive")
    diameter = next((d for cap, d in _STANDARD_DIAMETERS_MM if capacity_kl <= cap), 3000.0)
    radius_m = diameter / 2000
    length_m = capacity_kl / (math.pi * radius_m**2)
    return diameter, round(length_m * 1000, 1)


def volume_from_dip(dip_mm: float, diameter_mm: float, length_mm: float) -> float:
    """Litres of product at a dip of ``dip_mm`` (clamped to the tank's height)."""
    if diameter_mm <= 0 or length_mm <= 0:
        raise ValueError("tank dimensions must be positive")
    r = diameter_mm / 2000  # metres
    h = min(max(dip_mm, 0.0), diameter_mm) / 1000
    length = length_mm / 1000
    segment_area = r**2 * math.acos((r - h) / r) - (r - h) * math.sqrt(max(2 * r * h - h**2, 0.0))
    return segment_area * length * 1000  # m³ → litres


def dip_from_volume(volume_l: float, diameter_mm: float, length_mm: float, *, tol_l: float = 0.05) -> float:
    """Inverse of :func:`volume_from_dip` (bisection; volume is monotonic in dip)."""
    full = volume_from_dip(diameter_mm, diameter_mm, length_mm)
    if not 0 <= volume_l <= full + tol_l:
        raise ValueError(f"volume {volume_l:.1f} L outside 0..{full:.1f} L")
    lo, hi = 0.0, diameter_mm
    while hi - lo > 1e-4:
        mid = (lo + hi) / 2
        if volume_from_dip(mid, diameter_mm, length_mm) < volume_l:
            lo = mid
        else:
            hi = mid
        if abs(volume_from_dip(mid, diameter_mm, length_mm) - volume_l) <= tol_l:
            return mid
    return (lo + hi) / 2
