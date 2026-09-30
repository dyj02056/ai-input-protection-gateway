"""원문을 다루지 않는, 교육용 MVP 정책 결정 엔진(PDP).

이 모듈은 탐지 결과의 범주 ID만 판정합니다. 웹 요청을 보내거나 막지 않으며,
기본 정책은 실제 조직에 적용하기 위한 보안 정책이 아니라 동작 예시입니다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType


class Action(str, Enum):
    """정책 엔진이 반환할 수 있는 네 가지 조치."""

    ALLOW = "ALLOW"
    MASK = "MASK"
    REQUIRE_APPROVAL = "REQUIRE_APPROVAL"
    BLOCK = "BLOCK"


_ACTION_PRIORITY = {
    Action.ALLOW: 1,
    Action.MASK: 2,
    Action.REQUIRE_APPROVAL: 3,
    Action.BLOCK: 4,
}

_ACTION_REASON = {
    Action.ALLOW: "ALLOW_POLICY_MATCHED",
    Action.MASK: "MASK_POLICY_MATCHED",
    Action.REQUIRE_APPROVAL: "APPROVAL_POLICY_MATCHED",
    Action.BLOCK: "BLOCK_POLICY_MATCHED",
}


@dataclass(frozen=True)
class InspectionSummary:
    """원문 없이 탐지된 범주 ID만 보관하는 입력 요약."""

    detected_categories: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if isinstance(self.detected_categories, str):
            raise TypeError(
                "원문 문자열이 아니라 범주 ID의 컬렉션을 전달해야 합니다."
            )

        try:
            categories = frozenset(self.detected_categories)
        except TypeError as error:
            raise TypeError("탐지 범주는 문자열 컬렉션이어야 합니다.") from error

        if any(
            not isinstance(category, str) or not category or category != category.strip()
            for category in categories
        ):
            raise ValueError("탐지 범주는 공백이 없는 문자열 ID여야 합니다.")

        object.__setattr__(self, "detected_categories", categories)


@dataclass(frozen=True)
class Policy:
    """범주별 데모 조치와 미등록 범주의 기본 조치."""

    category_actions: Mapping[str, Action] = field(
        default_factory=lambda: {
            "government_id": Action.MASK,
            "phone_number": Action.MASK,
            "api_key": Action.BLOCK,
        }
    )
    unknown_category_action: Action = Action.REQUIRE_APPROVAL

    def __post_init__(self) -> None:
        if not isinstance(self.category_actions, Mapping):
            raise TypeError("category_actions는 범주 ID와 Action의 매핑이어야 합니다.")
        if not isinstance(self.unknown_category_action, Action):
            raise TypeError("unknown_category_action은 Action 값이어야 합니다.")

        copied_actions = dict(self.category_actions)
        for category, action in copied_actions.items():
            if not isinstance(category, str) or not category or category != category.strip():
                raise ValueError("정책 범주는 공백이 없는 문자열 ID여야 합니다.")
            if not isinstance(action, Action):
                raise TypeError("각 정책 조치는 Action 값이어야 합니다.")

        # 정책 매핑이 만들어진 뒤 임의로 바뀌지 않도록 읽기 전용 복사본을 둡니다.
        object.__setattr__(
            self, "category_actions", MappingProxyType(copied_actions)
        )


@dataclass(frozen=True)
class Decision:
    """PDP 판정 결과. 원문이나 원문 일부는 포함하지 않습니다."""

    action: Action
    reason_codes: tuple[str, ...]


DEFAULT_POLICY = Policy()


def decide(
    summary: InspectionSummary,
    policy: Policy = DEFAULT_POLICY,
) -> Decision:
    """탐지 요약과 정책으로 조치를 결정합니다.

    우선순위는 BLOCK > REQUIRE_APPROVAL > MASK > ALLOW입니다.
    탐지 범주가 없으면 ALLOW, 정책에 등록되지 않은 범주는 설정된
    unknown_category_action(기본값 REQUIRE_APPROVAL)을 적용합니다.
    """

    if not isinstance(summary, InspectionSummary):
        raise TypeError("summary는 InspectionSummary여야 합니다.")
    if not isinstance(policy, Policy):
        raise TypeError("policy는 Policy여야 합니다.")

    if not summary.detected_categories:
        return Decision(Action.ALLOW, ("NO_DETECTED_CATEGORY",))

    matched_actions: list[Action] = []
    has_unknown_category = False

    for category in summary.detected_categories:
        action = policy.category_actions.get(category)
        if action is None:
            action = policy.unknown_category_action
            has_unknown_category = True
        matched_actions.append(action)

    selected_action = max(matched_actions, key=_ACTION_PRIORITY.__getitem__)
    reason_codes = [_ACTION_REASON[selected_action]]
    if has_unknown_category:
        reason_codes.append("UNKNOWN_CATEGORY_PRESENT")

    return Decision(selected_action, tuple(sorted(reason_codes)))