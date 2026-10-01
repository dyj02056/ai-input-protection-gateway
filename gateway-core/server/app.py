"""PDP 서버 애플리케이션.

  GET  /healthz              상태 확인 (인증 없음)
  GET  /v1/policy            활성 정책 (ETag 지원). 확장 프로그램이 이것을 내려받아 로컬에서 판정합니다.
  GET  /v1/policy/versions   정책 버전 목록
  GET  /v1/policy/{version}  특정 버전
  POST /v1/decide            범주 ID·건수로 판정 (원문을 받지 않습니다)
  POST /v1/audit             감사 이벤트 수집 (해시 체인으로 추가 전용 저장)
  GET  /v1/audit, /v1/audit/head, /v1/audit/verify   관리자 키 전용
  POST /v1/approvals                승인 요청 만들기 (범주 ID·업무 목적·짧은 메모만)
  GET  /v1/approvals/{id}           내가 만든 요청의 상태
  POST /v1/approvals/{id}/consume   승인된 요청을 한 번 사용 (이후 다시 쓸 수 없음)
  GET  /v1/approvals                승인 요청 목록                          (관리자 키)
  POST /v1/approvals/{id}/decision  승인 또는 거절                          (관리자 키)
  GET  /v1/admin/policies, POST /v1/admin/policies, POST /v1/admin/policies/{version}/activate   (관리자 키)
  GET  /v1/admin/events, /v1/admin/events/verify   정책 변경·승인 처리 기록 (관리자 키)
  GET  /console                     관리 콘솔 화면 (키는 화면에서 입력하며, 데이터는 위 API로만 가져옵니다)

모든 /v1 요청은 `Authorization: Bearer <API 키>`가 필요합니다.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .approvals import STATUSES, ApprovalError, ApprovalStore
from .audit import AuditLog
from .auth import authenticate
from .decision import FileStatus, decide_file, decide_prompt
from .policies import PolicyDocument, PolicyError, PolicyStore
from .schemas import (
    ApprovalCreate,
    ApprovalCreated,
    ApprovalDecision,
    ApprovalState,
    AuditAck,
    AuditBatch,
    DecideRequest,
    DecideResponse,
    PolicyDraft,
    PolicyVersionInfo,
)
from .settings import Settings

logger = logging.getLogger("pdp")

CONSOLE_DIR = Path(__file__).resolve().parent / "console"
CONSOLE_ASSETS = {"console.js": "text/javascript; charset=utf-8", "console.css": "text/css; charset=utf-8"}
# 콘솔 화면에만 붙는 보안 헤더: 같은 출처의 스크립트·스타일만 허용하고, 다른 곳으로의 요청·프레임 삽입을 막습니다.
CONSOLE_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


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
    settings: Settings | None = None,
    store: PolicyStore | None = None,
    audit: AuditLog | None = None,
    approvals: ApprovalStore | None = None,
    admin_log: AuditLog | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    store = store or PolicyStore.from_directory(
        settings.policy_dir, settings.active_policy_version, settings.data_dir / "policies"
    )
    audit = audit or AuditLog(settings.audit_dir)
    approvals = approvals or ApprovalStore(
        settings.data_dir, settings.approval_pending_seconds, settings.approval_valid_seconds
    )
    # 정책 변경과 승인 처리 기록. 수집 감사 로그와 같은 해시 체인 방식이지만 파일은 따로 둡니다.
    admin_log = admin_log or AuditLog(settings.data_dir / "admin", name="admin_events.jsonl")

    # 문서 화면(/docs)은 켜지 않습니다. 공격 표면을 줄이기 위해서입니다.
    app = FastAPI(title="AI 입력정보 보호 게이트웨이 PDP", docs_url=None, redoc_url=None, openapi_url=None)
    # 감사 이벤트는 최대 50건 묶음이라 본문이 더 큽니다.
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_body_bytes, overrides={"/v1/audit": 32768, "/v1/admin/policies": 16384})

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

    def record_admin_event(who: str, kind: str, **details) -> None:
        admin_log.append(who, [{"event_id": uuid.uuid4().hex, "at": int(time.time() * 1000), "kind": kind, **details}])

    def approval_error(error: ApprovalError) -> HTTPException:
        return HTTPException(status_code=error.status, detail=error.message)

    # ---- 승인 요청 (요청하는 쪽: 일반 API 키) ----

    @app.post("/v1/approvals", response_model=ApprovalCreated, status_code=201)
    def create_approval(body: ApprovalCreate, who: str = Depends(caller)) -> ApprovalCreated:
        try:
            record = approvals.create(who, list(body.categories), body.channel, body.purpose, body.note.strip())
        except ApprovalError as error:
            raise approval_error(error) from None
        logger.info("approval.create caller=%s categories=%d", who, len(body.categories))
        return ApprovalCreated(approval_id=record["approval_id"], status=record["status"], expires_at=record["expires_at"])

    @app.get("/v1/approvals/{approval_id}", response_model=ApprovalState)
    def get_approval(approval_id: str, who: str = Depends(caller)) -> ApprovalState:
        record = approvals.get(approval_id, requester=who)
        if record is None:
            raise HTTPException(status_code=404, detail="승인 요청을 찾을 수 없습니다.")
        return ApprovalState(**ApprovalStore.public_view(record))

    @app.post("/v1/approvals/{approval_id}/consume", response_model=ApprovalState)
    def consume_approval(approval_id: str, who: str = Depends(caller)) -> ApprovalState:
        try:
            record = approvals.consume(approval_id, who)
        except ApprovalError as error:
            raise approval_error(error) from None
        logger.info("approval.consume caller=%s", who)
        return ApprovalState(**ApprovalStore.public_view(record))

    # ---- 승인 처리 (관리자 키) ----

    @app.get("/v1/approvals")
    def list_approvals(status: str | None = None, limit: int = 100, who: str = Depends(admin)):
        if (status is not None and status not in STATUSES) or not 1 <= limit <= 500:
            raise HTTPException(status_code=422, detail="status 또는 limit이 올바르지 않습니다.")
        return {"approvals": approvals.list(status, limit)}

    @app.post("/v1/approvals/{approval_id}/decision")
    def decide_approval(approval_id: str, body: ApprovalDecision, who: str = Depends(admin)):
        try:
            record = approvals.decide(approval_id, who, body.decision == "approve", body.note.strip())
        except ApprovalError as error:
            raise approval_error(error) from None
        record_admin_event(
            who, "approval." + body.decision, approval_id=approval_id, categories=record["categories"], channel=record["channel"]
        )
        logger.info("approval.%s approver=%s", body.decision, who)
        return record

    # ---- 정책 버전 관리 (관리자 키) ----

    def policy_entry(document: PolicyDocument) -> dict:
        return {**document.to_public_dict(), "etag": document.etag, "active": document.version == store.active.version}

    @app.get("/v1/admin/policies")
    def admin_policies(who: str = Depends(admin)):
        return {"active": store.active.version, "versions": [policy_entry(item) for item in store.versions()]}

    @app.post("/v1/admin/policies", status_code=201)
    def create_policy(body: PolicyDraft, who: str = Depends(admin)):
        previous = store.active.version
        try:
            document = store.create(
                {
                    "description": body.description,
                    "category_actions": dict(body.category_actions),
                    "unknown_category_action": body.unknown_category_action,
                    "bulk_record_threshold": body.bulk_record_threshold,
                }
            )
            record_admin_event(who, "policy.create", version=document.version, based_on=previous)
            if body.activate:
                store.activate(document.version)
                record_admin_event(who, "policy.activate", version=document.version, previous=previous)
        except PolicyError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        logger.info("policy.create admin=%s version=%d activate=%s", who, document.version, body.activate)
        return policy_entry(document)

    @app.post("/v1/admin/policies/{version}/activate")
    def activate_policy(version: int, who: str = Depends(admin)):
        previous = store.active.version
        try:
            document = store.activate(version)
        except PolicyError:
            raise HTTPException(status_code=404, detail="정책 버전을 찾을 수 없습니다.") from None
        if previous != version:
            record_admin_event(who, "policy.activate", version=version, previous=previous)
        logger.info("policy.activate admin=%s version=%d previous=%d", who, version, previous)
        return policy_entry(document)

    @app.get("/v1/admin/events")
    def admin_events(after: int = 0, limit: int = 100, who: str = Depends(admin)):
        if after < 0 or not 1 <= limit <= 500:
            raise HTTPException(status_code=422, detail="after는 0 이상, limit은 1~500이어야 합니다.")
        return {"records": admin_log.read(after, limit), "head": admin_log.head()}

    @app.get("/v1/admin/events/verify")
    def admin_events_verify(who: str = Depends(admin)):
        result = admin_log.verify()
        return {
            "ok": result.ok,
            "count": result.count,
            "head_seq": result.head_seq,
            "head_hash": result.head_hash,
            "broken_at": result.broken_at,
            "reason": result.reason,
        }

    # ---- 관리 콘솔 화면 (정적 파일. 데이터는 위 API로만 가져오며, 관리자 키는 화면에서 입력합니다) ----

    def console_response(name: str, media_type: str) -> Response:
        try:
            body = (CONSOLE_DIR / name).read_bytes()
        except OSError:
            raise HTTPException(status_code=404, detail="찾을 수 없습니다.") from None
        return Response(content=body, media_type=media_type, headers=CONSOLE_HEADERS)

    @app.get("/console")
    @app.get("/console/")
    def console_page() -> Response:
        return console_response("index.html", "text/html; charset=utf-8")

    @app.get("/console/{asset}")
    def console_asset(asset: str) -> Response:
        if asset not in CONSOLE_ASSETS:
            raise HTTPException(status_code=404, detail="찾을 수 없습니다.")
        return console_response(asset, CONSOLE_ASSETS[asset])

    return app
