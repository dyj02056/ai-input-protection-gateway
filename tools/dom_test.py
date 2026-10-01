"""content.js의 contenteditable 마스킹 동작과 1.1.0 기능을 실제 Chromium에서 검증합니다.

- `tools/dom_test.html`을 헤드리스 Chrome으로 열고, 알림창의 마스킹 버튼까지
  실제로 눌러 결과 DOM 구조와 시각적 줄 수를 확인합니다.
- ChatGPT·Claude·Gemini처럼 줄마다 `<p>`를 쓰는 편집기에서 마스킹 후 빈 줄이
  생기던 문제(innerText가 `<p>` 경계를 '\\n\\n'로 세는 문제)를 회귀 테스트로 막습니다.
- 이어서 1.1.0에서 추가한 기능을 확인합니다. 감지 안내가 20초 뒤에도 남아 있는지,
  닫기·실행 취소 버튼, 기본값에서 전송을 막지 않는지, 전송 차단·승인 확인을 켜면
  막는지, 감사 기록에 원문이 남지 않는지, 안내 위치 설정을 확인합니다.
- 시간 관련 검사는 `--virtual-time-budget`의 가상 시간으로 동작하므로
  테스트 자체는 몇 초 안에 끝납니다.

하네스는 소스가 아니라 빌드 산출물(`dist-ext/`의 detector.js·policy.js·content.js)을 읽으므로,
먼저 `npm run build`가 필요합니다.

사용법:
    npm run build
    py tools/dom_test.py
    py tools/dom_test.py --chrome "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(__file__).resolve().parent / "dom_test.html"
DIST_DIR = REPO_ROOT / "dist-ext"
DIST_SCRIPTS = ("detector.js", "policy.js", "content.js")

CHROME_CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)

OUTPUT_PATTERN = re.compile(r'<pre id="out">(.*?)</pre>', re.DOTALL)


def find_chrome(explicit: str | None) -> str:
    if explicit:
        return explicit
    for candidate in CHROME_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    raise FileNotFoundError(
        "Chrome 실행 파일을 찾지 못했습니다. --chrome 옵션으로 경로를 지정해 주세요."
    )


def run_harness(chrome: str, timeout: int) -> str:
    with tempfile.TemporaryDirectory(prefix="ai-gateway-dom-") as profile:
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--no-first-run",
            "--allow-file-access-from-files",
            # 하네스가 20초 유지 + 8초 자동 닫힘 + 1초 여유를 가상 시간으로 확인합니다.
            # 가상 시간이므로 실제 대기 시간은 거의 없습니다.
            "--virtual-time-budget=90000",
            "--window-size=1280,800",
            f"--user-data-dir={profile}",
            "--dump-dom",
            HARNESS.as_uri(),
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            timeout=timeout,
            check=False,
        )

    stdout = completed.stdout.decode("utf-8", errors="replace")
    match = OUTPUT_PATTERN.search(stdout)
    if not match:
        raise RuntimeError(
            "테스트 결과를 읽지 못했습니다. 브라우저 표준 출력이 비어 있는지 확인해 주세요.\n"
            + stdout[:1000]
        )
    return html.unescape(match.group(1)).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="content.js DOM 회귀 테스트 (헤드리스 Chrome)")
    parser.add_argument("--chrome", default=None, help="Chrome 실행 파일 경로")
    parser.add_argument("--timeout", type=int, default=90, help="실행 제한 시간(초)")
    args = parser.parse_args()

    missing = [name for name in DIST_SCRIPTS if not (DIST_DIR / name).is_file()]
    if missing:
        print(
            "dist-ext/에 " + ", ".join(missing) + "이(가) 없습니다. 먼저 `npm run build`를 실행하세요.",
            file=sys.stderr,
        )
        return 1

    chrome = find_chrome(args.chrome)
    print(f"chrome  : {chrome}")
    print(f"harness : {HARNESS.relative_to(REPO_ROOT)}")

    try:
        raw = run_harness(chrome, args.timeout)
    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as error:
        print(f"실행 실패: {error}", file=sys.stderr)
        return 2

    if not raw:
        print("테스트가 결과를 남기지 않았습니다. 스크립트 오류일 수 있습니다.", file=sys.stderr)
        return 2

    try:
        report = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"결과를 해석하지 못했습니다: {error}\n{raw[:2000]}", file=sys.stderr)
        return 2

    failed_labels = report.get("failures") or []
    for result in report.get("results", []):
        mark = "PASS" if result.get("ok") else "FAIL"
        print(f"[{mark}] {result.get('label')}")
        if not result.get("ok"):
            print(f"       actual  : {result.get('actual')!r}")
            print(f"       expected: {result.get('expected')!r}")

    total = report.get("total", 0)
    if failed_labels:
        print(f"\n{total - len(failed_labels)}/{total} 통과, {len(failed_labels)} 실패")
        return 1

    print(f"\n{total}/{total} 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
