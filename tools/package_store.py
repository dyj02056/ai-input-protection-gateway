"""Chrome 웹 스토어 제출용 ZIP 패키지를 만듭니다.

- `browser-extension/` 전체를 담되, 제출본에 필요 없는 개발 파일은 제외합니다.
- manifest.json에서 버전을 읽어 파일명에 사용합니다.
- ZIP 항목 경로는 항상 `/` 구분자를 씁니다(일부 도구의 `\\` 구분자는 스토어 업로드가 거부됨).

사용법:
    py tools/package_store.py
    py tools/package_store.py --out dist
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = REPO_ROOT / "browser-extension"

# 배포본에 넣지 않는 파일 (개발·문서·미사용 로고 시안)
EXCLUDE_FILES = {
    "detector.test.js",
    "README.md",
    "icons/logo-a.svg",
    "icons/logo-b.svg",
    "icons/logo-c.svg",
}

# 배포본에 반드시 있어야 하는 파일
REQUIRED_FILES = {
    "manifest.json",
    "detector.js",
    "content.js",
    "background.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "options.html",
    "options.js",
    "onboarding.html",
    "icons/logo.svg",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
}


def collect_files() -> list[Path]:
    files = []
    for path in sorted(EXT_DIR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(EXT_DIR).as_posix()
        if rel in EXCLUDE_FILES or rel.startswith("__pycache__/"):
            continue
        files.append(path)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="Chrome 웹 스토어 제출용 ZIP 생성")
    parser.add_argument("--out", default="dist", help="ZIP을 저장할 폴더 (기본: dist)")
    args = parser.parse_args()

    manifest = json.loads((EXT_DIR / "manifest.json").read_text(encoding="utf-8"))
    version = manifest.get("version", "0.0.0")

    files = collect_files()
    included = {p.relative_to(EXT_DIR).as_posix() for p in files}
    missing = sorted(REQUIRED_FILES - included)
    if missing:
        print("필수 파일이 없습니다: " + ", ".join(missing), file=sys.stderr)
        return 1

    # manifest가 참조하는 아이콘이 실제로 있는지 확인합니다.
    for size, rel in (manifest.get("icons") or {}).items():
        if rel not in included:
            print(f"manifest 아이콘 누락: {size} → {rel}", file=sys.stderr)
            return 1

    out_dir = (REPO_ROOT / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"ai-input-protection-gateway-{version}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in files:
            bundle.write(path, path.relative_to(EXT_DIR).as_posix())

    total = sum(p.stat().st_size for p in files)
    print(f"wrote {zip_path}")
    print(f"  version : {version}")
    print(f"  files   : {len(files)} (raw {total} bytes → zip {zip_path.stat().st_size} bytes)")
    for path in files:
        print("  + " + path.relative_to(EXT_DIR).as_posix())
    return 0


if __name__ == "__main__":
    sys.exit(main())
