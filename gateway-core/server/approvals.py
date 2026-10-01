"""승인 요청 저장소: REQUIRE_APPROVAL 판정을 사람이 승인·거절하는 흐름입니다.

상태: PENDING(대기) → APPROVED(승인) | REJECTED(거절) | EXPIRED(만료) → CONSUMED(사용됨)
  - 승인은 한 번만 쓸 수 있습니다(CONSUMED가 되면 다시 쓸 수 없습니다).
  - 대기 중인 요청은 `pending_seconds`가 지나면, 승인된 요청은 승인 후 `valid_seconds`가 지나면 만료됩니다.
  - 요청한 키와 같은 이름의 관리자 키로는 승인할 수 없습니다(자기 승인 금지).

서버가 아는 것: 범주 ID, 채널, 업무 목적(고정 선택지), 짧은 메모, 요청한 키의 이름, 시각.
서버가 모르는 것: 입력 원문, 파일 이름, 내용의 해시. "승인한 내용과 지금 보내는 내용이 같은가"는
확장이 이 브라우저 안에서만 비교합니다(내용이 서버로 나갈 이유가 없으므로).

저장은 JSON 파일 하나를 통째로 바꿔 쓰는 방식입니다(로컬 시연·소규모용). 완료된 요청은 90일 뒤에 지웁니다.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

PENDING, APPROVED, REJECTED, EXPIRED, CONSUMED = "PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"
STATUSES = (PENDING, APPROVED, REJECTED, EXPIRED, CONSUMED)
PURPOSES = ("customer_response", "document_review", "code_work", "data_analysis", "other")
MAX_PENDING_PER_REQUESTER = 50
RETENTION_SECONDS = 90 * 24 * 3600
FILE_NAME = "approvals.json"


class ApprovalError(Exception):
    """HTTP 상태와 사용자에게 보일 문구를 함께 들고 있는 오류."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class ApprovalStore:
    def __init__(
        self,
        directory: Path | None,
        pending_seconds: int = 4 * 3600,
        valid_seconds: int = 30 * 60,
        clock=time.time,
    ) -> None:
        self._path = directory / FILE_NAME if directory is not None else None
        self._pending_seconds = pending_seconds
        self._valid_seconds = valid_seconds
        self._clock = clock
        self._lock = threading.RLock()
        self._records: dict[str, dict] = {}
        self._load()

    # ---- 저장 ----

    def _load(self) -> None:
        if self._path is None or not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            records = data["records"]
            if not isinstance(records, list):
                raise TypeError("records")
            for record in records:
                if record["status"] not in STATUSES:
                    raise ValueError("status")
                self._records[record["approval_id"]] = record
        except (OSError, ValueError, KeyError, TypeError) as error:
            # 조용히 비워 두면 승인 기록이 사라지므로 시작을 거부합니다.
            raise RuntimeError(f"승인 요청 저장소가 손상되었습니다({FILE_NAME}): {error}") from error

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_name(self._path.name + ".tmp")
        payload = {"records": sorted(self._records.values(), key=lambda item: item["created_at"])}
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self._path)

    def _now_ms(self) -> int:
        return int(self._clock() * 1000)

    def _refresh(self, record: dict) -> bool:
        """만료 시각이 지난 PENDING/APPROVED를 EXPIRED로 바꿉니다. 바뀌었으면 True."""
        if record["status"] in (PENDING, APPROVED) and self._now_ms() >= record["expires_at"]:
            record["status"] = EXPIRED
            return True
        return False

    def _sweep(self) -> None:
        changed = False
        cutoff = self._now_ms() - RETENTION_SECONDS * 1000
        for approval_id in list(self._records):
            record = self._records[approval_id]
            changed |= self._refresh(record)
            if record["status"] not in (PENDING, APPROVED) and record["created_at"] < cutoff:
                del self._records[approval_id]
                changed = True
        if changed:
            self._save()

    @staticmethod
    def public_view(record: dict) -> dict:
        """요청한 쪽(확장)에 돌려주는 모양. 다른 사람의 메모나 요청자 이름은 넣지 않습니다."""
        return {
            "approval_id": record["approval_id"],
            "status": record["status"],
            "expires_at": record["expires_at"],
            "decision_note": record.get("decision_note", ""),
        }

    # ---- 요청하는 쪽 ----

    def create(self, requester: str, categories: list[str], channel: str, purpose: str, note: str) -> dict:
        if purpose not in PURPOSES:
            raise ApprovalError(422, "업무 목적이 올바르지 않습니다.")
        with self._lock:
            self._sweep()
            pending = sum(1 for r in self._records.values() if r["requester"] == requester and r["status"] == PENDING)
            if pending >= MAX_PENDING_PER_REQUESTER:
                raise ApprovalError(429, "대기 중인 승인 요청이 너무 많습니다. 처리된 뒤에 다시 요청하세요.")
            now = self._now_ms()
            record = {
                "approval_id": uuid.uuid4().hex,
                "requester": requester,
                "categories": sorted(set(categories)),
                "channel": channel,
                "purpose": purpose,
                "note": note,
                "status": PENDING,
                "created_at": now,
                "expires_at": now + self._pending_seconds * 1000,
            }
            self._records[record["approval_id"]] = record
            self._save()
            return dict(record)

    def get(self, approval_id: str, requester: str | None = None) -> dict | None:
        """requester를 주면 그 키가 만든 요청만 돌려줍니다(남의 요청은 없는 것처럼)."""
        with self._lock:
            record = self._records.get(approval_id)
            if record is None or (requester is not None and record["requester"] != requester):
                return None
            if self._refresh(record):
                self._save()
            return dict(record)

    def consume(self, approval_id: str, requester: str) -> dict:
        """승인된 요청을 한 번 씁니다. 승인 상태가 아니면(대기·거절·만료·이미 사용) 409."""
        with self._lock:
            record = self._records.get(approval_id)
            if record is None or record["requester"] != requester:
                raise ApprovalError(404, "승인 요청을 찾을 수 없습니다.")
            if self._refresh(record):
                self._save()
            if record["status"] != APPROVED:
                raise ApprovalError(409, "사용할 수 있는 승인이 아닙니다.")
            record["status"] = CONSUMED
            record["consumed_at"] = self._now_ms()
            self._save()
            return dict(record)

    # ---- 승인하는 쪽 ----

    def list(self, status: str | None = None, limit: int = 100) -> list[dict]:
        with self._lock:
            self._sweep()
            rows = [dict(r) for r in self._records.values() if status is None or r["status"] == status]
        rows.sort(key=lambda item: item["created_at"], reverse=True)
        return rows[:limit]

    def decide(self, approval_id: str, approver: str, approve: bool, note: str) -> dict:
        with self._lock:
            record = self._records.get(approval_id)
            if record is None:
                raise ApprovalError(404, "승인 요청을 찾을 수 없습니다.")
            if record["requester"] == approver:
                raise ApprovalError(403, "본인이 요청한 건은 승인할 수 없습니다.")
            if self._refresh(record):
                self._save()
            if record["status"] != PENDING:
                raise ApprovalError(409, "이미 처리되었거나 만료된 요청입니다.")
            now = self._now_ms()
            record["status"] = APPROVED if approve else REJECTED
            record["decided_at"] = now
            record["decided_by"] = approver
            record["decision_note"] = note
            if approve:
                record["expires_at"] = now + self._valid_seconds * 1000
            self._save()
            return dict(record)
