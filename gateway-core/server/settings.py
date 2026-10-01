"""환경 변수에서 읽는 서버 설정.

API 키는 코드·설정 파일·저장소에 두지 않고 환경 변수로만 받습니다. 이 저장소는 공개입니다.

  PDP_API_KEYS          이름=키 목록 (쉼표로 구분). 예: acme=...,beta=...
  PDP_API_KEYS_SHA256   이름=SHA-256(키)의 16진수 목록. 평문 키를 환경에 두기 싫을 때 씁니다.
  PDP_ALLOW_NO_AUTH     "1"이면 인증 없이 시작합니다. 로컬 개발 전용이며 127.0.0.1에서만 쓰세요.
  PDP_POLICY_DIR        정책 파일(*.json) 폴더. 기본: 이 폴더의 policy_files/
  PDP_ACTIVE_POLICY_VERSION  활성 정책 버전. 기본: 가장 높은 버전
  PDP_MAX_BODY_BYTES    요청 본문 크기 상한. 기본 4096 (원문이 아니라 범주 ID만 받기 때문입니다)
  PDP_ADMIN_KEYS_SHA256 / PDP_ADMIN_KEYS  감사 로그를 읽고 검증할 수 있는 관리자 키(위 API 키와 같은 형식).
                        일반 API 키는 로그를 쓰기만 하고 읽지 못합니다.
  PDP_AUDIT_DIR         감사 로그(audit.jsonl) 폴더. 기본: 이 폴더의 audit_data/ (커밋되지 않음)
  PDP_DATA_DIR          콘솔이 만든 정책 버전, 승인 요청, 관리 기록을 두는 폴더. 기본: 이 폴더의 data/ (커밋되지 않음)
  PDP_APPROVAL_TTL_MINUTES    승인 요청이 처리되지 않고 만료되기까지의 시간. 기본 240(4시간)
  PDP_APPROVAL_VALID_MINUTES  승인된 뒤 한 번 쓸 수 있는 기간. 기본 30
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType

MIN_KEY_LENGTH = 24  # 이보다 짧은 키는 거부합니다. `py tools/server.py newkey`가 만드는 키는 43자입니다.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")

DEFAULT_POLICY_DIR = Path(__file__).resolve().parent / "policy_files"
DEFAULT_AUDIT_DIR = Path(__file__).resolve().parent / "audit_data"
DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"


class ConfigError(ValueError):
    """설정이 올바르지 않을 때. 서버는 시작하지 않습니다."""


def digest(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _split_pairs(raw: str, variable: str) -> list[tuple[str, str]]:
    pairs = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        name, separator, value = item.partition("=")
        if not separator or not _NAME.fullmatch(name.strip()) or not value.strip():
            # 값은 오류 메시지에 넣지 않습니다(키가 로그에 남지 않도록).
            raise ConfigError(f"{variable}: '이름=값' 형식이 아닌 항목이 있습니다.")
        pairs.append((name.strip(), value.strip()))
    return pairs


def _read_keys(env: Mapping[str, str], variable: str) -> dict[str, str]:
    digests: dict[str, str] = {}
    for name, key in _split_pairs(env.get(variable, ""), variable):
        if len(key) < MIN_KEY_LENGTH:
            raise ConfigError(f"{variable}: '{name}'의 키가 너무 짧습니다(최소 {MIN_KEY_LENGTH}자).")
        digests[name] = digest(key)
    hashed = variable + "_SHA256"
    for name, value in _split_pairs(env.get(hashed, ""), hashed):
        if not _SHA256.fullmatch(value):
            raise ConfigError(f"{hashed}: '{name}'의 값이 SHA-256(16진수 64자)이 아닙니다.")
        if name in digests:
            raise ConfigError(f"키 이름이 겹칩니다: {name}")
        digests[name] = value.lower()
    return digests


@dataclass(frozen=True)
class Settings:
    # 이름 -> SHA-256(키). 평문 키는 메모리에 오래 두지 않습니다.
    api_key_digests: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))
    allow_no_auth: bool = False
    policy_dir: Path = DEFAULT_POLICY_DIR
    active_policy_version: int | None = None
    max_body_bytes: int = 4096
    # 감사 로그를 읽을 수 있는 관리자 키(이름 -> SHA-256). 일반 키와 별개입니다.
    admin_key_digests: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))
    audit_dir: Path = DEFAULT_AUDIT_DIR
    # 콘솔에서 바꾸는 상태(정책 버전·승인 요청·관리 기록)
    data_dir: Path = DEFAULT_DATA_DIR
    approval_pending_seconds: int = 240 * 60
    approval_valid_seconds: int = 30 * 60

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        digests = _read_keys(env, "PDP_API_KEYS")
        admin_digests = _read_keys(env, "PDP_ADMIN_KEYS")
        overlap = set(digests.values()) & set(admin_digests.values())
        if overlap:
            raise ConfigError("일반 API 키와 관리자 키가 같은 값입니다. 서로 다른 키를 쓰세요.")

        allow_no_auth = env.get("PDP_ALLOW_NO_AUTH", "") == "1"
        if not digests and not allow_no_auth:
            raise ConfigError(
                "API 키가 없습니다. PDP_API_KEYS(또는 PDP_API_KEYS_SHA256)를 설정하세요. "
                "`py tools/server.py newkey`로 키를 만들 수 있습니다. "
                "로컬 개발에서만 PDP_ALLOW_NO_AUTH=1로 인증 없이 시작할 수 있습니다."
            )

        def integer(name: str, default: int | None, low: int, high: int) -> int | None:
            raw = env.get(name)
            if raw is None or raw.strip() == "":
                return default
            try:
                value = int(raw)
            except ValueError:
                raise ConfigError(f"{name}: 정수여야 합니다.") from None
            if not low <= value <= high:
                raise ConfigError(f"{name}: {low}~{high} 범위여야 합니다.")
            return value

        policy_dir = Path(env["PDP_POLICY_DIR"]) if env.get("PDP_POLICY_DIR") else DEFAULT_POLICY_DIR
        return cls(
            api_key_digests=MappingProxyType(digests),
            allow_no_auth=allow_no_auth,
            policy_dir=policy_dir,
            active_policy_version=integer("PDP_ACTIVE_POLICY_VERSION", None, 1, 1_000_000),
            max_body_bytes=integer("PDP_MAX_BODY_BYTES", 4096, 256, 65536) or 4096,
            admin_key_digests=MappingProxyType(admin_digests),
            audit_dir=Path(env["PDP_AUDIT_DIR"]) if env.get("PDP_AUDIT_DIR") else DEFAULT_AUDIT_DIR,
            data_dir=Path(env["PDP_DATA_DIR"]) if env.get("PDP_DATA_DIR") else DEFAULT_DATA_DIR,
            approval_pending_seconds=(integer("PDP_APPROVAL_TTL_MINUTES", 240, 1, 10_080) or 240) * 60,
            approval_valid_seconds=(integer("PDP_APPROVAL_VALID_MINUTES", 30, 1, 1_440) or 30) * 60,
        )
