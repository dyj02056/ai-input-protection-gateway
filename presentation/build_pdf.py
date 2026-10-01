"""발표자료(index.html)를 PDF로 내보냅니다. 헤드리스 Chrome(또는 Edge)의 인쇄 기능을 씁니다.

  py presentation/build_pdf.py [--chrome <브라우저 실행 파일>]

- 슬라이드 1장 = PDF 1쪽(1280×720). 인쇄용 스타일은 index.html의 @media print에 있습니다.
- 아이콘(FontAwesome)을 CDN에서 읽으므로 인터넷 연결이 필요합니다.
- 결과: presentation/slides.pdf
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "index.html"
OUTPUT = HERE / "slides.pdf"

CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)


def find_browser(explicit: str | None) -> str:
    if explicit:
        return explicit
    for candidate in CANDIDATES:
        if Path(candidate).exists():
            return candidate
    found = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")
    if found:
        return found
    sys.exit("Chrome/Edge를 찾지 못했습니다. --chrome 으로 실행 파일 경로를 알려 주세요.")


def main() -> int:
    parser = argparse.ArgumentParser(description="발표자료 PDF 내보내기")
    parser.add_argument("--chrome", help="Chrome 또는 Edge 실행 파일 경로")
    args = parser.parse_args()

    browser = find_browser(args.chrome)
    OUTPUT.unlink(missing_ok=True)
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=20000",  # 웹폰트(아이콘)를 다 읽을 때까지 기다립니다
        f"--print-to-pdf={OUTPUT}",
        SOURCE.as_uri(),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not OUTPUT.exists():
        print(result.stderr[-800:], file=sys.stderr)
        return 1

    pages = len(re.findall(rb"/Type\s*/Page[^s]", OUTPUT.read_bytes()))
    slides = len(re.findall(r'<section class="slide', SOURCE.read_text(encoding="utf-8")))
    print(f"{OUTPUT.name}: {pages}쪽 (슬라이드 {slides}장), {OUTPUT.stat().st_size // 1024}KB")
    return 0 if pages == slides else 2


if __name__ == "__main__":
    sys.exit(main())
