"""PDP 서버 애플리케이션.

  GET  /healthz              상태 확인 (인증 없음)
  GET  /v1/policy            활성 정책 (ETag 지원). 확장 프로그램이 이것을 내려받아 로컬에서 판정합니다.
  GET  /v1/policy/versions   정책 버전 목록
  GET  /v1/policy/{version}  특정 버전
  POST /v1/decide            범주 ID·건수로 판정 (원문을 받지 않습니다)
  POST /v1/audit             감사 이벤트 수집 (해시 체인으로 추가 전용 저장)
  GET  /v1/audit, /v1/audit/head, /v1/audit/verify   관리자 키 전용

모든 /v1 요청은 `Authorization: Bearer <API 키>`가 필요합니다.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .audit import AuditLog
from .auth import authenticate
from .decision import FileStatus, decide_file, decide_prompt
from .policies import PolicyDocument, PolicyStore
from .schemas import AuditAck, AuditBatch, DecideRequest, DecideResponse, PolicyVersionInfo
from .settings import Settings

logger = logging.getLogger("pdp")


class BodyLimitMiddleware:
    """요청 본문이 상한을 넘으면 413으로 거절합니다. 이 서버는 범주 ID만 받으므로 본문이 클 이유가 없습니다."""

    def __init__(self, app, max_bytes: int, overrides: dict[str, int] | None = None) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.overrides = overrides or {}

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.overrides.get(scope.get("path", ""), self.max_bytes)
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._reject(send)
            return

        received = 0
        too_large = False

        async def limited_receive():
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_large = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        sent_start = False

        async def guarded_send(message):
            nonlocal sent_start
            if too_large and not sent_start and message["type"] == "http.response.start":
                sent_start = True
                await self._reject(send)
                return
            if too_large and sent_start:
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)

    async def _reject(self, send) -> None:
        body = b'{"detail":"\\uc694\\uccad\\uc774 \\ub108\\ubb34 \\ud07d\\ub2c8\\ub2e4."}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})


def _etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    candidates = [part.strip().removeprefix("W/") for part in header.split(",")]
    return "*" in candidates or etag in candidates


def create_app(
    settings: Settings | None = None, store: PolicyStore | None = None, audit: AuditLog | None = None
) -> FastAPI:
    settings = settings or Settings.from_env()
    store = store or PolicyStore.from_directory(settings.policy_dir, settings.active_policy_version)
    audit = audit or AuditLog(settings.audit_dir)

    # 문서 화면(/docs)은 켜지 않습니다. 공격 표면을 줄이기 위해서입니다.
    app = FastAPI(title="AI 입력정보 보호 게이트웨이 PDP", docs_url=None, redoc_url=None, openapi_url=None)
    # 감사 이벤트는 최대 50건 묶음이라 본문이 더 큽니다.
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_body_bytes, overrides={"/v1/audit": 32768})

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        # 기본 응답은 받은 값(input)을 그대로 되돌려 줍니다. 원문이 잘못 들어와도 되돌려 보내지 않도록 위치와 이유만 돌려줍니다.
        details = [{"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]} for item in error.errors()]
        return JSONResponse(status_code=422, content={"detail": details})

    def caller(request: Request) -> str:
        return authenticate(request, settings)

    def admin(request: Request) -> str:
        return authenticate(request, settings, admin=True)

    def document_for(version: int | None) -> PolicyDocument:
        if version is None:
            return store.active
        found = store.get(version)
        if found is None:
            raise HTTPException(status_code=404, detail="정책 버전을 찾을 수 없습니다.")
        return found

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/v1/policy")
    def get_active_policy(request: Request, response: Response, who: str = Depends(caller)):
        document = store.active
        response.headers["ETag"] = document.etag
        if _etag_matches(request.headers.get("if-none-match"), document.etag):
            return Response(status_code=304, headers={"ETag": document.etag, "Cache-Control": "no-store"})
        return document.to_public_dict()

    @app.get("/v1/policy/versions", response_model=list[PolicyVersionInfo])
    def list_versions(who: str = Depends(caller)):
        active = store.active.version
        return [
            PolicyVersionInfo(version=item.version, active=item.version == active, etag=item.etag, description=item.description)
            for item in store.versions()
        ]

    @app.get("/v1/policy/{version}")
    def get_policy_version(version: int, response: Response, who: str = Depends(caller)):
        document = document_for(version)
        response.headers["ETag"] = document.etag
        return document.to_public_dict()

    @app.post("/v1/decide", response_model=DecideResponse)
    def decide(body: DecideRequest, who: str = Depends(caller)) -> DecideResponse:
        document = document_for(body.policy_version)
        categories = set(body.detected_categories)
        if body.channel == "file":
            assert body.file_status is not None  # 스키마가 보장합니다
            decision = decide_file(FileStatus(body.file_status), categories, body.record_count, document)
        else:
            decision = decide_prompt(categories, document)

        # 로그에는 범주 ID나 내용을 남기지 않고 개수만 남깁니다.
        logger.info(
            "decide caller=%s channel=%s categories=%d action=%s policy=v%d",
            who, body.channel, len(categories), decision.action.value, document.version,
        )
        return DecideResponse(
            decision_id=uuid.uuid4().hex,
            action=decision.action.value,
            reason_codes=list(decision.reason_codes),
            policy_id=document.policy_id,
            policy_version=document.version,
        )

    @app.post("/v1/audit", response_model=AuditAck)
    def post_audit(body: AuditBatch, who: str = Depends(caller)) -> AuditAck:
        result = audit.append(who, [event.model_dump() for event in body.events])
        logger.info("audit caller=%s accepted=%d duplicates=%d", who, result["accepted"], result["duplicates"])
        return AuditAck(accepted=result["accepted"], duplicates=result["duplicates"], head_seq=result["head_seq"])

    @app.get("/v1/audit")
    def read_audit(after: int = 0, limit: int = 100, who: str = Depends(admin)):
        if after < 0 or not 1 <= limit <= 500:
            raise HTTPException(status_code=422, detail="after는 0 이상, limit은 1~500이어야 합니다.")
        return {"records": audit.read(after, limit)}

    @app.get("/v1/audit/head")
    def audit_head(who: str = Depends(admin)):
        return audit.head()

    @app.get("/v1/audit/verify")
    def audit_verify(who: str = Depends(admin)):
        result = audit.verify()
        return {
            "ok": result.ok,
            "count": result.count,
            "head_seq": result.head_seq,
            "head_hash": result.head_hash,
            "broken_at": result.broken_at,
            "reason": result.reason,
        }

    return app
