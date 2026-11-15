"""ORM models. Importing this package registers every table on ``Base.metadata`` (Alembic relies on it).

The model mirrors how a sales area actually works:

* **network**   – sales area, depots, dealers, outlets and their tanks, nozzles and licences
* **readings**  – time series: tank readings (dips, tank gauges) and pump totaliser readings
* **sales**     – the daily sales report (DSR), one row per nozzle per business day
* **supply**    – indents (orders) and tank-truck receipts with their density checks
* **ops**       – alerts raised by the rules engine, file-import jobs and the audit log
"""

from prahari.models.network import Dealer, Depot, Licence, Nozzle, Outlet, Product, SalesArea, Tank
from prahari.models.ops import Alert, AuditLog, ImportJob
from prahari.models.readings import TankReading, TotalizerReading
from prahari.models.sales import NozzleDailySales
from prahari.models.supply import Indent, Receipt

__all__ = [
    "Alert",
    "AuditLog",
    "Dealer",
    "Depot",
    "ImportJob",
    "Indent",
    "Licence",
    "Nozzle",
    "NozzleDailySales",
    "Outlet",
    "Product",
    "Receipt",
    "SalesArea",
    "Tank",
    "TankReading",
    "TotalizerReading",
]
