"""Starting a new demo day.

The generator rebuilds a whole month ending "yesterday" every time it runs, and the numbers it
gives deliveries and indents are not stable across days. Importing a new day's month on top of
the previous one would mix two different histories (an invoice number pointing at a different
delivery, receipts that no longer match the dips). So when the generated data is for a new
business day, the demo's transactional records are cleared first; masters (outlets, tanks,
licences are re-imported anyway), live automation readings and the audit log are kept.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from prahari.models import Indent, NozzleDailySales, Receipt, TankReading
from prahari.models.readings import SOURCE_DIP_REGISTER

log = logging.getLogger(__name__)


def start_new_demo_day_if_needed(session: Session, last_complete_day: date) -> bool:
    """Clear generated transactional data if it ends on a different day than ``last_complete_day``.

    Returns True if data was cleared. Running again on the same day changes nothing, so actions
    taken during the day (holds, requests) survive a restart.
    """
    latest = session.scalar(select(func.max(NozzleDailySales.business_date)))
    if latest is None or latest == last_complete_day:
        return False
    for stmt in (
        delete(NozzleDailySales),
        delete(TankReading).where(TankReading.source == SOURCE_DIP_REGISTER),
        delete(Receipt),
        delete(Indent),
    ):
        session.execute(stmt)
    log.info("new demo day: cleared data ending %s (now %s)", latest, last_complete_day)
    return True
