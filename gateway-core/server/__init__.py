"""PDP(정책 결정점) HTTP 서버.

원문을 받지 않습니다. 탐지된 범주 ID와 건수만 받아 정책 판정을 돌려주고, 확장 프로그램에는 버전이 있는 정책을
내려줍니다. 판정 규칙의 핵심은 `gateway-core/pdp/policy.py`를 그대로 씁니다.
"""

from __future__ import annotations

import sys
from pathlib import Path

# gateway-core/pdp/policy.py는 패키지가 아니라 단일 모듈이라, 서버가 import 할 수 있게 경로를 더합니다.
_PDP_DIR = str(Path(__file__).resolve().parent.parent / "pdp")
if _PDP_DIR not in sys.path:
    sys.path.insert(0, _PDP_DIR)
