"""API 키 인증. 키는 SHA-256 해시로만 비교하고, 키 값은 로그나 오류에 쓰지 않습니다."""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

from .settings import Settings, digest

# 인증 실패의 이유(키가 틀렸는지, 없는지, 형식이 이상한지)를 구분해서 알려주지 않습니다.
_UNAUTHORIZED = HTTPException(
    status_code=401,
    detail="인증이 필요합니다.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def authenticate(request: Request, settings: Settings, admin: bool = False) -> str:
    """통과하면 호출자 이름을 돌려줍니다. 실패하면 401. admin이면 관리자 키만 받습니다."""
    keys = settings.admin_key_digests if admin else settings.api_key_digests
    if settings.allow_no_auth and not settings.api_key_digests and not settings.admin_key_digests:
        return "anonymous"

    token = _bearer_token(request)
    if token is None:
        raise _UNAUTHORIZED

    provided = digest(token)
    matched: str | None = None
    # 일치하는 키를 찾아도 끝까지 모두 비교합니다(비교 시간이 키 위치에 따라 달라지지 않도록).
    for name, expected in keys.items():
        if hmac.compare_digest(provided, expected):
            matched = name
    if matched is None:
        raise _UNAUTHORIZED
    return matched
