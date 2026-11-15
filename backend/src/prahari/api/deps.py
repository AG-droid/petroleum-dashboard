"""Shared FastAPI dependencies."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from prahari.config import Settings, get_settings
from prahari.db.session import get_session

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_ACTOR_RE = re.compile(r"[^\w .@-]")


def get_actor(x_prahari_user: Annotated[str | None, Header()] = None) -> str:
    """Who is acting, for the audit log, and a guard against cross-site requests.

    Every state-changing endpoint requires the ``X-Prahari-User`` header. Browsers only send custom
    headers after a CORS preflight, which our CORS policy refuses for other origins, so a page on
    another site can't make the user's browser acknowledge alerts or upload files (CSRF).

    There is no login yet (planned with roles): the value is a display name, sanitised, and is
    **not** authentication.
    """
    name = _ACTOR_RE.sub("", (x_prahari_user or "").strip())[:60]
    if not name:
        raise HTTPException(403, "missing X-Prahari-User header; cross-site requests are refused")
    return name


ActorDep = Annotated[str, Depends(get_actor)]
