#!/usr/bin/env python3
"""policy.js(브라우저 로컬 정책)와 policy.py(PDP)의 판정이 같은지 교차 확인합니다.

두 엔진은 따로 관리되므로 한쪽 규칙만 바뀌면 이 검사가 실패합니다.
`tools/policy_cases.json`의 공용 케이스 표를 Python 엔진에 돌려 결과를 비교합니다.
JS 쪽은 `node --test browser-extension/policy.test.js`가 같은 표를 사용합니다.

사용법:
    py tools/policy_parity.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = Path(__file__).resolve().parent / "policy_cases.json"
PDP_DIR = REPO_ROOT / "gateway-core" / "pdp"

sys.path.insert(0, str(PDP_DIR))

from policy import InspectionSummary, decide  # noqa: E402


def main() -> int:
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))["cases"]
    failures = []

    for case in cases:
        summary = InspectionSummary(frozenset(case["categories"]))
        decision = decide(summary)
        action = decision.action.value
        reasons = list(decision.reason_codes)

        if action != case["action"] or reasons != case["reasonCodes"]:
            failures.append(
                f"{case['name']}: 기대 {case['action']}/{case['reasonCodes']} "
                f"실제 {action}/{reasons}"
            )
        else:
            print(f"[PASS] {case['name']}: {action}")

    if failures:
        print(f"\n{len(cases) - len(failures)}/{len(cases)} 일치, {len(failures)} 불일치")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(f"\n{len(cases)}/{len(cases)} 일치 (policy.py 기준)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
