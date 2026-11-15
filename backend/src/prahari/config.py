"""Application settings, read from environment variables (prefix ``PRAHARI_``) or a ``.env`` file.

Everything that differs between a laptop, CI and a server lives here, so the code itself never
hard-codes a connection string, secret or business threshold.
"""

from __future__ import annotations

from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RuleThresholds(BaseSettings):
    """Business thresholds used by the alert rules.

    The defaults are illustrative values for the demo, not official OMC limits. They are kept in
    configuration (not code) so an operator can tune them without a release.
    """

    model_config = SettingsConfigDict(env_prefix="PRAHARI_RULE_", extra="ignore")

    dry_out_days: float = Field(1.5, description="Raise a supply alert below this many days of cover.")
    cover_window_days: int = Field(7, description="Days of sales history used to estimate daily demand.")
    variation_pct: float = Field(0.5, description="Max. book-vs-physical stock loss, % of sales.")
    variation_window_days: int = Field(3, description="Business days the variation is measured over.")
    density_tolerance: float = Field(3.0, description="Max. |observed - invoice| density at 15 °C, kg/m³.")
    licence_warn_days: int = Field(30, description="Warn when a licence expires within this many days.")
    licence_urgent_days: int = Field(10, description="Escalate when a licence expires within this many days.")
    automation_stale_minutes: int = Field(120, description="An automated outlet is offline after this gap.")


class Settings(BaseSettings):
    """Top-level settings."""

    model_config = SettingsConfigDict(env_prefix="PRAHARI_", env_file=".env", extra="ignore")

    env: str = Field("development", description="development | test | production")
    database_url: str = "postgresql+psycopg://prahari:prahari@localhost:5432/prahari"
    log_level: str = "INFO"
    log_json: bool = Field(False, description="Emit one JSON object per log line (use in containers).")
    timezone: str = "Asia/Kolkata"
    # A petrol pump's business day usually runs from the morning dip to the next morning dip.
    business_day_start_hour: int = Field(6, ge=0, le=23)
    rules_interval_seconds: int = Field(60, ge=5, description="How often the rules engine runs.")
    run_scheduler: bool = Field(True, description="Run the rules engine inside the API process.")
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:8080"])
    max_upload_mb: int = 20

    rules: RuleThresholds = Field(default_factory=RuleThresholds)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings (cached; call ``get_settings.cache_clear()`` in tests)."""
    return Settings()
