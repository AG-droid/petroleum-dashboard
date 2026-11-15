"""Shared FastAPI dependencies."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from prahari.config import Settings, get_settings
from prahari.db.session import get_session

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_ACTOR_RE = re.compile(r"[^\w .@-]")


def get_actor(x_prahari_user: Annotated[str | None, Header()] = None) -> str:
    """Who is acting, for the audit log.

    There is no login yet (planned with roles): the dashboard sends a display name in the
    ``X-Prahari-User`` header. It is sanitised and is **not** an authentication mechanism.
    """
    name = _ACTOR_RE.sub("", (x_prahari_user or "").strip())[:60]
    return name or "anonymous"


ActorDep = Annotated[str, Depends(get_actor)]
