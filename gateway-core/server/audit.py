"""감사 로그 수집: 추가 전용(append-only) JSONL 파일에 해시 체인으로 쌓습니다.

각 기록의 hash = SHA-256(이전 기록의 hash + "\n" + 이 기록 본문의 정규화 JSON).
중간 기록을 고치거나 지우거나 순서를 바꾸면 그 뒤의 해시가 모두 어긋나 `verify()`가 처음 깨진 번호를 알려 줍니다.

한계(정직하게): 파일을 쓸 수 있는 사람이 체인 전체를 새로 계산해 덮어쓰면 서버만으로는 알 수 없습니다.
그래서 `head()`(마지막 번호와 해시)를 서버 밖(관리자 메모, 다른 시스템)에 주기적으로 남겨 두어야 변조를 확실히 잡습니다.
이 로그에는 입력 원문이나 파일 이름이 없고, 이벤트 시각·조치·범주 ID·채널·정책 버전만 있습니다.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

GENESIS_HASH = "0" * 64
LOG_NAME = "audit.jsonl"


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def chain_hash(previous: str, body: dict) -> str:
    return hashlib.sha256((previous + "\n" + canonical(body)).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    count: int
    head_seq: int
    head_hash: str
    broken_at: int | None = None
    reason: str = ""


class AuditLog:
    def __init__(self, directory: Path, clock=time.time) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self._path = directory / LOG_NAME
        self._clock = clock
        self._lock = threading.Lock()
        self._seq = 0
        self._hash = GENESIS_HASH
        self._seen: set[str] = set()
        self._load()

    def _load(self) -> None:
        """시작할 때 기존 로그를 읽어 마지막 번호·해시·이벤트 ID를 복원합니다. 깨져 있으면 시작하지 않습니다."""
        if not self._path.exists():
            return
        result = self.verify()
        if not result.ok:
            raise RuntimeError(f"감사 로그가 손상되었습니다(번호 {result.broken_at}: {result.reason}). 서버를 시작하지 않습니다.")
        for record in self._records():
            self._seen.add(record["event_id"])
        self._seq, self._hash = result.head_seq, result.head_hash

    def _records(self):
        if not self._path.exists():
            return
        with self._path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)

    def append(self, caller: str, events: list[dict]) -> dict:
        """이벤트를 추가합니다. 이미 받은 event_id는 건너뜁니다(재시도해도 중복되지 않음)."""
        accepted = 0
        duplicates = 0
        with self._lock:
            lines = []
            seq, previous = self._seq, self._hash
            for event in events:
                if event["event_id"] in self._seen:
                    duplicates += 1
                    continue
                seq += 1
                body = {
                    "seq": seq,
                    "event_id": event["event_id"],
                    "received_at": int(self._clock() * 1000),
                    "caller": caller,
                    "event": event,
                }
                digest = chain_hash(previous, body)
                lines.append(canonical({**body, "prev_hash": previous, "hash": digest}))
                self._seen.add(event["event_id"])
                previous = digest
                accepted += 1
            if lines:
                with self._path.open("a", encoding="utf-8", newline="\n") as handle:
                    handle.write("\n".join(lines) + "\n")
                    handle.flush()
                self._seq, self._hash = seq, previous
            return {"accepted": accepted, "duplicates": duplicates, "head_seq": self._seq, "head_hash": self._hash}

    def head(self) -> dict:
        with self._lock:
            return {"seq": self._seq, "hash": self._hash}

    def read(self, after: int = 0, limit: int = 100) -> list[dict]:
        out = []
        for record in self._records():
            if record["seq"] > after:
                out.append(record)
                if len(out) >= limit:
                    break
        return out

    def verify(self) -> VerifyResult:
        previous, expected_seq, count = GENESIS_HASH, 0, 0
        try:
            for record in self._records():
                expected_seq += 1
                body = {k: record[k] for k in ("seq", "event_id", "received_at", "caller", "event")}
                if record.get("seq") != expected_seq:
                    return VerifyResult(False, count, expected_seq - 1, previous, expected_seq, "번호가 이어지지 않음")
                if record.get("prev_hash") != previous:
                    return VerifyResult(False, count, expected_seq - 1, previous, expected_seq, "이전 해시가 맞지 않음")
                if chain_hash(previous, body) != record.get("hash"):
                    return VerifyResult(False, count, expected_seq - 1, previous, expected_seq, "내용이 바뀜")
                previous, count = record["hash"], count + 1
        except (KeyError, TypeError, ValueError):
            return VerifyResult(False, count, expected_seq - 1, previous, expected_seq, "형식이 올바르지 않음")
        return VerifyResult(True, count, count, previous)
