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
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CASES_PATH = Path(__file__).resolve().parent / "policy_cases.json"
PDP_DIR = REPO_ROOT / "gateway-core" / "pdp"

sys.path.insert(0, str(PDP_DIR))

from policy import DEFAULT_POLICY, InspectionSummary, decide  # noqa: E402

REGISTRY_TS = REPO_ROOT / "browser-extension" / "src" / "shared" / "categories.ts"


def load_registry() -> list[dict]:
    """TS 범주 등록부를 Node로 읽어 옵니다(Node 22.18+는 TypeScript를 그대로 실행합니다)."""
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("범주 등록부를 읽으려면 Node.js가 필요합니다.")
    script = (
        "import(process.argv[1]).then(m => console.log(JSON.stringify(m.CATEGORIES)))"
    )
    result = subprocess.run(
        [node, "-e", script, REGISTRY_TS.as_uri()],
        capture_output=True, text=True, encoding="utf-8", check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("범주 등록부를 읽지 못했습니다: " + result.stderr.strip()[:300])
    return json.loads(result.stdout)


def check_registry_defaults() -> list[str]:
    """등록부의 모든 범주가 파이썬 기본 정책에 같은 조치로 있는지 확인합니다."""
    problems = []
    registry = {item["id"]: item["defaultAction"] for item in load_registry()}
    python = {category: action.value for category, action in DEFAULT_POLICY.category_actions.items()}
    for category, action in registry.items():
        if category not in python:
            problems.append(f"등록부의 {category}가 policy.py 기본 정책에 없습니다")
        elif python[category] != action:
            problems.append(f"{category}: 등록부 {action} / policy.py {python[category]}")
    for category in python:
        if category not in registry:
            problems.append(f"policy.py의 {category}가 등록부에 없습니다")
    return problems


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

    # 공용 케이스표와 별개로, 범주 등록부(TS)의 기본 조치가 policy.py와 같은지도 확인합니다.
    # 케이스표에 없는 범주가 새로 생겨도 어긋남을 잡기 위해서입니다.
    registry_problems = check_registry_defaults()
    if registry_problems:
        print("\n범주 등록부 ↔ policy.py 불일치:")
        for problem in registry_problems:
            print(f"  - {problem}")
        return 1
    print("[PASS] 범주 등록부의 기본 조치가 policy.py와 같음")

    if failures:
        print(f"\n{len(cases) - len(failures)}/{len(cases)} 일치, {len(failures)} 불일치")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(f"\n{len(cases)}/{len(cases)} 일치 (policy.py 기준)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
