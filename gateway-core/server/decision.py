"""정책 문서로 판정합니다. 입력 원문은 받지 않고 범주 ID·건수·파일 상태만 다룹니다.

브라우저 확장(`browser-extension/src/content/files/inspect.ts`의 decideFileAction)과 같은 규칙입니다.
둘이 어긋나면 `tools/policy_parity.py`가 실패합니다.
"""

from __future__ import annotations

from collections.abc import Iterable
from enum import Enum

from policy import Action, Decision, InspectionSummary, decide

from .policies import PolicyDocument

_PRIORITY = {Action.ALLOW: 1, Action.MASK: 2, Action.REQUIRE_APPROVAL: 3, Action.BLOCK: 4}


class FileStatus(str, Enum):
    """파일 검사 결과의 상태. 확장 프로그램의 FileStatus와 같은 이름입니다."""

    CLEAN = "clean"  # 검사했고 감지된 것이 없음
    DETECTED = "detected"  # 검사했고 개인정보·비밀 형식이 감지됨
    UNINSPECTED = "uninspected"  # 지원하지 않는 형식이라 검사하지 못함
    ENCRYPTED = "encrypted"  # 암호가 걸려 검사하지 못함
    TOO_LARGE = "too-large"  # 너무 커서 검사하지 않음
    FAILED = "failed"  # 읽거나 해석하지 못함


def decide_prompt(categories: Iterable[str], document: PolicyDocument) -> Decision:
    """입력창 글자에서 감지된 범주로 판정합니다."""
    return decide(InspectionSummary(frozenset(categories)), document.to_policy())


def decide_file(
    status: FileStatus,
    categories: Iterable[str],
    record_count: int,
    document: PolicyDocument,
) -> Decision:
    """첨부파일 검사 결과로 판정합니다.

    - 감지된 것이 없으면 ALLOW (안전하다는 뜻은 아닙니다)
    - 감지됐다면 정책의 판정을 따르되, 파일은 값을 가릴 수 없으므로 최소 REQUIRE_APPROVAL
    - 표에서 감지된 행이 bulk_record_threshold 이상이면 BLOCK
    - 검사하지 못한 파일(암호화·미지원·실패·너무 큼)은 REQUIRE_APPROVAL: 조용히 통과시키지 않습니다
    """
    if status is FileStatus.CLEAN:
        return Decision(Action.ALLOW, ("FILE_CLEAN",))
    if status is not FileStatus.DETECTED:
        return Decision(Action.REQUIRE_APPROVAL, ("FILE_NOT_INSPECTED",))

    base = decide_prompt(categories, document)
    action = base.action
    reasons = set(base.reason_codes)
    if _PRIORITY[action] < _PRIORITY[Action.REQUIRE_APPROVAL]:
        action = Action.REQUIRE_APPROVAL
        reasons = {"FILE_CANNOT_MASK"} | (reasons - {"MASK_POLICY_MATCHED", "ALLOW_POLICY_MATCHED"})
    if record_count >= document.bulk_record_threshold:
        action = Action.BLOCK
        reasons.add("BULK_RECORDS")
    return Decision(action, tuple(sorted(reasons)))
