"""JWT token helpers for username-only auth."""
from __future__ import annotations
import datetime
import os
import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY  = os.environ.get("JWT_SECRET", "quarry-dev-secret-change-before-launch")
ALGORITHM   = "HS256"
EXPIRE_DAYS = 30

# Comma-separated list of usernames with tutor/admin access
_ADMIN_USERNAMES = {
    u.strip().lower()
    for u in os.environ.get("ADMIN_USERNAMES", "tutor").split(",")
    if u.strip()
}

_bearer = HTTPBearer(auto_error=False)


def is_admin_username(username: str) -> bool:
    return username.lower() in _ADMIN_USERNAMES


def create_token(user_id: int, username: str) -> str:
    payload = {
        "sub":      str(user_id),
        "username": username,
        "is_admin": is_admin_username(username),
        "exp":      datetime.datetime.utcnow() + datetime.timedelta(days=EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_user(creds: HTTPAuthorizationCredentials = Security(_bearer)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Login required")
    return _decode(creds.credentials)


def require_admin(creds: HTTPAuthorizationCredentials = Security(_bearer)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Login required")
    payload = _decode(creds.credentials)
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Tutor access required")
    return payload


def optional_user(creds: HTTPAuthorizationCredentials = Security(_bearer)) -> dict | None:
    if not creds:
        return None
    try:
        return _decode(creds.credentials)
    except HTTPException:
        return None
