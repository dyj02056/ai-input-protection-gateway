#!/usr/bin/env python3
"""PDP 서버를 다루는 도구.

  py tools/server.py setup            가상환경(gateway-core/server/.venv)을 만들고 의존성을 설치
  py tools/server.py test             서버 테스트 실행
  py tools/server.py newkey [--name]  새 API 키를 만들어 한 번만 보여주고, 환경 변수에 넣을 해시 줄도 출력
  py tools/server.py run              서버 실행 (기본 127.0.0.1:8787)
  py tools/server.py e2e              서버를 임시로 띄워 확장 프로그램의 정책 동기화 코드를 실제로 연결해 시험

API 키는 코드·설정 파일에 두지 않습니다. `run`은 gateway-core/server/.env(커밋되지 않음)가 있으면 읽고,
없으면 현재 환경 변수를 씁니다. 이 저장소는 공개입니다.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GATEWAY_CORE = REPO_ROOT / "gateway-core"
SERVER_DIR = GATEWAY_CORE / "server"
VENV_DIR = SERVER_DIR / ".venv"
ENV_FILE = SERVER_DIR / ".env"


def venv_python() -> Path:
    scripts = "Scripts" if os.name == "nt" else "bin"
    return VENV_DIR / scripts / ("python.exe" if os.name == "nt" else "python")


def require_venv() -> Path:
    python = venv_python()
    if not python.exists():
        sys.exit("가상환경이 없습니다. 먼저 `py tools/server.py setup`을 실행하세요.")
    return python


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE 줄만 읽는 아주 단순한 .env 해석기입니다(따옴표·주석 줄 처리 정도)."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def cmd_setup(_: argparse.Namespace) -> int:
    if not VENV_DIR.exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    python = venv_python()
    subprocess.run([str(python), "-m", "pip", "install", "-q", "-r", str(SERVER_DIR / "requirements.txt")], check=True)
    print(f"준비 완료: {python}")
    return 0


def cmd_test(_: argparse.Namespace) -> int:
    python = require_venv()
    return subprocess.run(
        [str(python), "-m", "unittest", "discover", "-s", "server", "-p", "test_*.py", "-t", "."],
        cwd=GATEWAY_CORE,
        check=False,
    ).returncode


def cmd_newkey(args: argparse.Namespace) -> int:
    key = secrets.token_urlsafe(32)  # 43자
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    print("새 API 키입니다. 지금 한 번만 보여 드리며, 서버에는 해시만 두는 것을 권합니다.")
    print()
    print(f"  API 키 (확장 프로그램 설정에 입력):\n    {key}")
    print()
    print("  서버 환경 변수 (평문 키를 서버에 두지 않으려면 해시만):")
    print(f"    PDP_API_KEYS_SHA256={args.name}={digest}")
    print()
    print("이 값들을 코드·설정 파일·메신저에 남기지 마세요. 키를 잃어버리면 새로 만들어 교체하세요.")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    python = require_venv()
    env = {**os.environ, **read_env_file(ENV_FILE)}
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("경고: 로컬 주소가 아닌 곳에 열려고 합니다. 인증서(HTTPS)를 쓰는 역방향 프록시 뒤에서만 이렇게 하세요.", file=sys.stderr)
    command = [str(python), "-m", "uvicorn", "server.main:app", "--host", args.host, "--port", str(args.port)]
    return subprocess.run(command, cwd=GATEWAY_CORE, env=env, check=False).returncode


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def cmd_e2e(_: argparse.Namespace) -> int:
    """서버를 임시 키로 띄우고, vitest의 서버 연동 시험을 실제 HTTP로 돌립니다."""
    python = require_venv()
    port = free_port()
    key = secrets.token_urlsafe(32)
    env = {**os.environ, "PDP_API_KEYS": f"e2e={key}"}
    server = subprocess.Popen(
        [str(python), "-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=GATEWAY_CORE,
        env=env,
    )
    try:
        for _attempt in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1).read()
                break
            except OSError:
                time.sleep(0.1)
        else:
            print("서버가 시작되지 않았습니다.", file=sys.stderr)
            return 1
        npx = "npx.cmd" if os.name == "nt" else "npx"
        test_env = {**os.environ, "PDP_E2E_URL": f"http://127.0.0.1:{port}", "PDP_E2E_KEY": key}
        return subprocess.run(
            [npx, "vitest", "run", "browser-extension/src/background/policySync.e2e.test.ts"],
            cwd=REPO_ROOT,
            env=test_env,
            check=False,
        ).returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="PDP 서버 도구")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("setup").set_defaults(func=cmd_setup)
    sub.add_parser("test").set_defaults(func=cmd_test)
    newkey = sub.add_parser("newkey")
    newkey.add_argument("--name", default="default", help="키 이름(예: 조직 이름)")
    newkey.set_defaults(func=cmd_newkey)
    run = sub.add_parser("run")
    run.add_argument("--host", default="127.0.0.1")
    run.add_argument("--port", type=int, default=8787)
    run.set_defaults(func=cmd_run)
    sub.add_parser("e2e").set_defaults(func=cmd_e2e)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
