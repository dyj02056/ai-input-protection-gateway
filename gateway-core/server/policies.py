"""버전이 있는 정책 문서와 저장소.

정책은 `policies/*.json` 파일입니다. 파일을 읽을 때 모양을 엄격하게 검사하고, 어긋나면 서버가 시작되지 않습니다.
(잘못된 정책으로 조용히 동작하는 것보다 시작을 거부하는 편이 안전합니다.)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from policy import Action, Policy  # gateway-core/pdp/policy.py

CATEGORY_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MAX_CATEGORIES = 64
MAX_BULK_THRESHOLD = 1_000_000
ACTIVE_FILE = "active.json"
# 콘솔로 새 버전을 만들 때도 완화할 수 없는 범주(계획서의 non_overridable). 비밀·결제 정보는 항상 BLOCK입니다.
LOCKED_BLOCK_CATEGORIES = frozenset({"api_key", "credit_card", "password"})


class PolicyError(ValueError):
    """정책 파일이 올바르지 않을 때."""


@dataclass(frozen=True)
class PolicyDocument:
    policy_id: str
    version: int
    description: str
    category_actions: Mapping[str, Action]
    unknown_category_action: Action
    # 표(CSV·XLSX)에서 감지된 행이 이 수 이상이면 대량 반출로 보고 BLOCK (계획서의 대량 고객정보 규칙)
    bulk_record_threshold: int

    def to_policy(self) -> Policy:
        return Policy(
            category_actions=dict(self.category_actions),
            unknown_category_action=self.unknown_category_action,
        )

    def to_public_dict(self) -> dict:
        """API로 내려주는 모양. 확장 프로그램이 이 모양을 검사해서 씁니다."""
        return {
            "policy_id": self.policy_id,
            "version": self.version,
            "description": self.description,
            "category_actions": {category: action.value for category, action in sorted(self.category_actions.items())},
            "unknown_category_action": self.unknown_category_action.value,
            "bulk_record_threshold": self.bulk_record_threshold,
        }

    @property
    def etag(self) -> str:
        """내용이 같으면 같은 값. 정규화한 JSON의 해시입니다."""
        canonical = json.dumps(self.to_public_dict(), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return '"' + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32] + '"'


def _parse_action(value: object, where: str) -> Action:
    if not isinstance(value, str):
        raise PolicyError(f"{where}: 조치 이름은 문자열이어야 합니다.")
    try:
        return Action(value)
    except ValueError:
        allowed = ", ".join(action.value for action in Action)
        raise PolicyError(f"{where}: 알 수 없는 조치 '{value}' (허용: {allowed})") from None


def parse_policy(data: object, source: str = "정책") -> PolicyDocument:
    if not isinstance(data, dict):
        raise PolicyError(f"{source}: 객체(JSON object)여야 합니다.")

    known = {"policy_id", "version", "description", "category_actions", "unknown_category_action", "bulk_record_threshold"}
    extra = sorted(set(data) - known)
    if extra:
        raise PolicyError(f"{source}: 알 수 없는 항목 {extra}")

    policy_id = data.get("policy_id")
    if not isinstance(policy_id, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", policy_id):
        raise PolicyError(f"{source}: policy_id는 소문자·숫자·-·_ 로 된 이름이어야 합니다.")

    version = data.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise PolicyError(f"{source}: version은 1 이상의 정수여야 합니다.")

    description = data.get("description", "")
    if not isinstance(description, str) or len(description) > 500:
        raise PolicyError(f"{source}: description은 500자 이하 문자열이어야 합니다.")

    raw_actions = data.get("category_actions")
    if not isinstance(raw_actions, dict) or not raw_actions:
        raise PolicyError(f"{source}: category_actions는 비어 있지 않은 객체여야 합니다.")
    if len(raw_actions) > MAX_CATEGORIES:
        raise PolicyError(f"{source}: category_actions가 너무 많습니다(최대 {MAX_CATEGORIES}).")
    category_actions: dict[str, Action] = {}
    for category, action in raw_actions.items():
        if not isinstance(category, str) or not CATEGORY_ID_PATTERN.fullmatch(category):
            raise PolicyError(f"{source}: 범주 ID 형식이 올바르지 않습니다: {category!r}")
        category_actions[category] = _parse_action(action, f"{source}: category_actions.{category}")

    unknown = _parse_action(data.get("unknown_category_action"), f"{source}: unknown_category_action")

    threshold = data.get("bulk_record_threshold")
    if isinstance(threshold, bool) or not isinstance(threshold, int) or not 1 <= threshold <= MAX_BULK_THRESHOLD:
        raise PolicyError(f"{source}: bulk_record_threshold는 1~{MAX_BULK_THRESHOLD} 정수여야 합니다.")

    return PolicyDocument(
        policy_id=policy_id,
        version=version,
        description=description,
        category_actions=MappingProxyType(category_actions),
        unknown_category_action=unknown,
        bulk_record_threshold=threshold,
    )


def _atomic_write(path: Path, text: str) -> None:
    """같은 폴더에 임시 파일을 쓴 뒤 바꿔 치웁니다. 쓰는 도중 멈춰도 반쯤 쓰인 파일이 남지 않습니다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


class PolicyStore:
    """같은 policy_id의 여러 버전을 들고, 하나를 활성(active)으로 둡니다.

    버전은 한 번 만들면 고치지 않습니다(불변). 정책을 바꾸는 것은 새 버전을 만드는 것이고,
    롤백은 이전 버전을 다시 활성으로 지정하는 것입니다. `data_dir`이 있으면 콘솔로 만든 버전과
    활성 버전을 그 폴더에 저장해 서버를 다시 시작해도 유지합니다. (기본 정책 파일 폴더는 건드리지 않습니다.)
    """

    def __init__(
        self, documents: list[PolicyDocument], active_version: int | None = None, data_dir: Path | None = None
    ) -> None:
        if not documents:
            raise PolicyError("정책이 하나도 없습니다.")
        ids = {document.policy_id for document in documents}
        if len(ids) != 1:
            raise PolicyError(f"한 서버에는 policy_id가 하나여야 합니다: {sorted(ids)}")
        by_version: dict[int, PolicyDocument] = {}
        for document in documents:
            if document.version in by_version:
                raise PolicyError(f"같은 버전이 두 번 있습니다: v{document.version}")
            by_version[document.version] = document
        self._by_version = dict(sorted(by_version.items()))
        chosen = active_version if active_version is not None else max(self._by_version)
        if chosen not in self._by_version:
            raise PolicyError(f"활성 버전 v{chosen}에 해당하는 정책 파일이 없습니다.")
        self._active_version = chosen
        self._data_dir = data_dir
        self._lock = threading.RLock()

    @classmethod
    def from_directory(
        cls, directory: Path, active_version: int | None = None, data_dir: Path | None = None
    ) -> "PolicyStore":
        files = sorted(directory.glob("*.json"))
        if data_dir is not None and data_dir.exists():
            files += sorted(path for path in data_dir.glob("policy.v*.json"))
        if not [file for file in files if file.parent == directory]:
            raise PolicyError(f"정책 파일(*.json)이 없습니다: {directory}")
        documents = []
        for file in files:
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise PolicyError(f"{file.name}: 읽을 수 없습니다 ({error})") from error
            documents.append(parse_policy(data, file.name))

        # 콘솔에서 지정한 활성 버전이 있으면 그것이 환경 변수보다 우선합니다(콘솔이 가장 최근 결정이므로).
        if data_dir is not None and (data_dir / ACTIVE_FILE).exists():
            try:
                saved = json.loads((data_dir / ACTIVE_FILE).read_text(encoding="utf-8"))
                active_version = saved["version"]
                if isinstance(active_version, bool) or not isinstance(active_version, int):
                    raise TypeError("version")
            except (OSError, ValueError, KeyError, TypeError) as error:
                raise PolicyError(f"{ACTIVE_FILE}: 읽을 수 없습니다 ({error})") from error
        return cls(documents, active_version, data_dir)

    @property
    def active(self) -> PolicyDocument:
        return self._by_version[self._active_version]

    def get(self, version: int) -> PolicyDocument | None:
        return self._by_version.get(version)

    def versions(self) -> list[PolicyDocument]:
        return list(self._by_version.values())

    def create(self, fields: dict) -> PolicyDocument:
        """활성 정책의 policy_id를 이어받아 다음 번호의 새 버전을 만듭니다(활성으로 바꾸지는 않습니다)."""
        with self._lock:
            version = max(self._by_version) + 1
            document = parse_policy(
                {
                    "policy_id": self.active.policy_id,
                    "version": version,
                    "description": fields.get("description", ""),
                    "category_actions": fields.get("category_actions"),
                    "unknown_category_action": fields.get("unknown_category_action"),
                    "bulk_record_threshold": fields.get("bulk_record_threshold"),
                },
                "새 정책",
            )
            for category in sorted(LOCKED_BLOCK_CATEGORIES):
                effective = document.category_actions.get(category, document.unknown_category_action)
                if effective != Action.BLOCK:
                    raise PolicyError(f"새 정책: '{category}'(비밀·결제 정보)는 BLOCK보다 약하게 둘 수 없습니다.")
            if self._data_dir is not None:
                _atomic_write(
                    self._data_dir / f"policy.v{version}.json",
                    json.dumps(document.to_public_dict(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                )
            self._by_version[version] = document
            return document

    def activate(self, version: int) -> PolicyDocument:
        """이 버전을 활성으로 지정합니다. 이전 버전으로 되돌리는 롤백도 같은 동작입니다."""
        with self._lock:
            document = self._by_version.get(version)
            if document is None:
                raise PolicyError(f"v{version}에 해당하는 정책이 없습니다.")
            if self._data_dir is not None:
                _atomic_write(self._data_dir / ACTIVE_FILE, json.dumps({"version": version}) + "\n")
            self._active_version = version
            return document
