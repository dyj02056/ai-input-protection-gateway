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
sys.path.insert(0, str(REPO_ROOT / "gateway-core"))

from policy import DEFAULT_POLICY, InspectionSummary, decide  # noqa: E402
from server.decision import FileStatus, decide_file  # noqa: E402
from server.policies import PolicyStore, parse_policy  # noqa: E402

REGISTRY_TS = REPO_ROOT / "browser-extension" / "src" / "shared" / "categories.ts"
SERVER_POLICY_DIR = REPO_ROOT / "gateway-core" / "server" / "policy_files"


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


def check_server_default_policy() -> list[str]:
    """서버가 기본으로 내려주는 정책 파일이 범주 등록부의 기본 조치와 같은지 확인합니다.

    다르면 "서버에 연결하지 않은 확장"과 "기본 정책을 받은 확장"의 판정이 달라집니다.
    """
    problems = []
    registry = {item["id"]: item["defaultAction"] for item in load_registry()}
    store = PolicyStore.from_directory(SERVER_POLICY_DIR)
    document = parse_policy(
        json.loads((SERVER_POLICY_DIR / "default.v1.json").read_text(encoding="utf-8")), "default.v1.json"
    )
    served = {category: action.value for category, action in document.category_actions.items()}
    if store.active.version < 1:
        problems.append("활성 정책 버전이 올바르지 않습니다")
    for category, action in registry.items():
        if served.get(category) != action:
            problems.append(f"서버 기본 정책 {category}: {served.get(category)} / 등록부 {action}")
    for category in served:
        if category not in registry:
            problems.append(f"서버 기본 정책의 {category}가 등록부에 없습니다")
    if document.unknown_category_action.value != "REQUIRE_APPROVAL":
        problems.append("서버 기본 정책의 미등록 범주 조치가 REQUIRE_APPROVAL이 아닙니다")
    if document.bulk_record_threshold != 100:
        problems.append("서버 기본 정책의 대량 기준이 100이 아닙니다(확장의 BULK_RECORD_THRESHOLD와 같아야 합니다)")
    return problems


def run_policy_cases(data: dict) -> list[str]:
    """조직 정책(custom_policy)으로 판정한 결과가 케이스 표와 같은지 확인합니다."""
    failures = []
    document = parse_policy(data["custom_policy"], "custom_policy")
    for case in data["policy_cases"]:
        decision = decide(InspectionSummary(frozenset(case["categories"])), document.to_policy())
        actual = (decision.action.value, list(decision.reason_codes))
        if actual != (case["action"], case["reasonCodes"]):
            failures.append(f"{case['name']}: 기대 {case['action']}/{case['reasonCodes']} 실제 {actual}")
        else:
            print(f"[PASS] {case['name']}: {actual[0]}")
    return failures


def run_file_cases(data: dict) -> list[str]:
    """첨부파일 판정(서버 decide_file)이 케이스 표와 같은지 확인합니다."""
    failures = []
    default_document = parse_policy(
        json.loads((SERVER_POLICY_DIR / "default.v1.json").read_text(encoding="utf-8")), "default.v1.json"
    )
    custom_document = parse_policy(data["custom_policy"], "custom_policy")
    for case in data["file_cases"]:
        document = custom_document if case["policy"] == "custom" else default_document
        decision = decide_file(FileStatus(case["status"]), case["categories"], case["recordCount"], document)
        if decision.action.value != case["action"]:
            failures.append(f"{case['name']}: 기대 {case['action']} 실제 {decision.action.value}")
        else:
            print(f"[PASS] {case['name']}: {decision.action.value}")
    return failures


def main() -> int:
    data = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    cases = data["cases"]
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

    server_problems = check_server_default_policy()
    if server_problems:
        print("\n서버 기본 정책 ↔ 범주 등록부 불일치:")
        for problem in server_problems:
            print(f"  - {problem}")
        return 1
    print("[PASS] 서버 기본 정책 파일이 범주 등록부·확장 기본값과 같음")

    failures += run_policy_cases(data)
    failures += run_file_cases(data)

    if failures:
        print(f"\n{len(failures)}건 불일치")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    total = len(cases) + len(data["policy_cases"]) + len(data["file_cases"])
    print(f"\n{total}/{total} 일치 (policy.py·서버 기준)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
