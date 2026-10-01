"""uvicorn이 읽는 진입점: `uvicorn server.main:app` (gateway-core 폴더에서).

설정이 잘못되면(API 키 없음 등) 이유를 알리고 시작하지 않습니다.
"""

from __future__ import annotations

import sys

from .policies import PolicyError
from .settings import ConfigError

try:
    from .app import create_app

    app = create_app()
except (ConfigError, PolicyError, RuntimeError) as error:
    sys.stderr.write(f"[PDP 서버] 시작할 수 없습니다: {error}\n")
    raise SystemExit(2) from None
