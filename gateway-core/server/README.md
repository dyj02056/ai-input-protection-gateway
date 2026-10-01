# PDP 서버 (v0.1, 교육·데모용)

브라우저 확장(조직 정책 서버 연동)이 정책을 내려받는 작은 HTTP 서버입니다. 판정 엔진은 `../pdp/policy.py`를 그대로 씁니다.

> **이 서버는 로컬 개발·시연용입니다.** 운영에 쓰려면 아래 "운영 전에 해야 할 일"을 먼저 보세요. 호스팅·배포는 이 저장소의 범위 밖입니다.

## 시작하기

```bash
py tools/server.py setup                       # 가상환경 생성 + 의존성 설치 (gateway-core/server/.venv, 커밋되지 않음)
py tools/server.py newkey --name my-org        # 새 API 키를 한 번만 보여 주고, 서버에 넣을 해시 줄을 출력
```

출력된 `PDP_API_KEYS_SHA256=my-org=<해시>` 줄을 **환경 변수**나 `gateway-core/server/.env`(커밋되지 않음)에 넣고 실행합니다. 평문 키 대신 해시만 서버에 두는 것을 권합니다.

```bash
py tools/server.py run                         # 기본 127.0.0.1:8787
```

확장 프로그램 설정 → "조직 정책 서버"에 `http://127.0.0.1:8787`과 `newkey`가 보여 준 API 키를 입력해 연결합니다.

> **키를 코드·설정 파일·채팅·커밋에 넣지 마세요.** 이 저장소는 공개입니다. `.env.example`은 값이 비어 있는 예시이고, 실제 `.env`는 `.gitignore`가 막습니다. 키가 노출됐다면 즉시 `newkey`로 새로 만들어 교체하세요.

## 환경 변수 (`.env.example` 참고)

| 변수 | 설명 |
|---|---|
| `PDP_API_KEYS_SHA256` | `이름=SHA-256 16진수 64자`를 쉼표로 이어서. **권장** |
| `PDP_API_KEYS` | `이름=키`(24자 이상). 평문이라 개발용 |
| `PDP_ALLOW_NO_AUTH` | `1`이면 키가 없을 때 인증 없이 시작. **로컬 개발 전용** |
| `PDP_POLICY_DIR` | 정책 파일 폴더. 기본 `server/policy_files` |
| `PDP_ACTIVE_POLICY_VERSION` | 활성 버전. 기본은 가장 높은 버전 |
| `PDP_MAX_BODY_BYTES` | 요청 본문 상한(256~65536). 기본 4096 |

키도 `PDP_ALLOW_NO_AUTH`도 없으면 서버가 **시작을 거부**합니다(기본이 열린 서버가 되지 않게). 오류 메시지는 키 값을 되풀이하지 않습니다.

## API

모든 `/v1` 요청에 `Authorization: Bearer <API 키>`가 필요합니다. 틀린 키·없는 키·형식 오류는 같은 401로 답합니다.

| 메서드·경로 | 설명 |
|---|---|
| `GET /healthz` | 상태 확인(인증 없음) |
| `GET /v1/policy` | 활성 정책. `ETag`를 주고 `If-None-Match`가 맞으면 `304`. **확장이 쓰는 유일한 호출입니다** |
| `GET /v1/policy/versions` | 정책 버전 목록(활성 표시) |
| `GET /v1/policy/{version}` | 특정 버전 |
| `POST /v1/decide` | 범주 ID·건수·파일 상태로 판정. 원문을 받지 않습니다. 아직 확장은 쓰지 않고, 이후 다른 집행 지점(API 프록시 등)을 위한 것입니다 |

`/v1/decide` 요청 예:

```json
{"detected_categories": ["phone_number"], "channel": "file", "file_status": "detected", "record_count": 120}
```

`channel`은 `prompt` 또는 `file`입니다. 모르는 필드는 거절(422)하고, 거절 응답은 받은 값을 되돌려 보내지 않습니다.

## 정책 버전 관리

`policy_files/`의 `*.json` 한 개가 정책 한 버전입니다. 한 서버는 `policy_id` 하나만 가지며 `version`(1 이상의 정수)이 겹치면 시작하지 않습니다. 새 규칙은 **새 파일을 추가**(`default.v2.json`)하고 `PDP_ACTIVE_POLICY_VERSION`으로 활성화합니다. 롤백은 활성 버전을 되돌리는 것입니다(확장은 서버가 정한 버전을 그대로 따릅니다). 항목이 틀리면(모르는 키·조치 이름·범주 ID 형식·범위) 서버가 시작하지 않습니다.

```json
{
  "policy_id": "default",
  "version": 2,
  "description": "…",
  "category_actions": {"email": "BLOCK", "phone_number": "MASK"},
  "unknown_category_action": "REQUIRE_APPROVAL",
  "bulk_record_threshold": 100
}
```

기본 정책 파일은 확장의 내장 기본값과 같아야 하며, `py tools/policy_parity.py`가 범주 등록부와 대조합니다.

## 보안 설계

- 키 비교는 `hmac.compare_digest`(상수 시간)로 모든 키를 같은 방식으로 돌립니다. 서버는 키의 SHA-256만 메모리에 둡니다.
- `/docs`·`/openapi.json`은 끕니다. 응답에 `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- 요청 본문 상한(413), 범주 ID는 `^[a-z][a-z0-9_]{0,63}$`, 목록 32개·행 수 상한, `extra="forbid"`.
- 로그에는 호출자 이름·채널·범주 **개수**·조치·정책 버전만 남기고 범주 ID나 내용은 남기지 않습니다.
- 확장은 이 서버에 **입력 내용·파일·감지 결과를 보내지 않습니다**(정책을 내려받기만 합니다).

## 운영 전에 해야 할 일 (이 서버가 하지 않는 것)

1. **HTTPS**: 이 서버는 TLS를 직접 처리하지 않습니다. 인증서를 쓰는 역방향 프록시 뒤에 두세요. 확장은 원격 http 주소를 거부합니다.
2. **속도 제한·IP 제한**: 키 대입 공격을 막으려면 프록시나 방화벽에서 제한하세요.
3. **키 관리**: 키는 조직당 하나이며 사용자별 구분·만료·폐기 이력이 없습니다. SSO·사용자별 키는 이후 단계입니다.
4. **정책 변경 권한·변경 이력**: 정책 파일을 고칠 수 있는 사람이 곧 관리자입니다. 관리 화면과 승인 절차는 이후 단계입니다.
5. **가용성**: 서버가 멈춰도 확장은 이전 정책으로 계속 판정합니다. 다만 정책 변경이 늦게 퍼집니다(사이트를 열 때 확인, 10분 간격).

## 시험

```bash
py tools/server.py test      # 서버 단위 시험 36개
py tools/server.py e2e       # 서버를 임시 키로 띄워 확장의 동기화 코드와 실제 HTTP로 연결(6개). /v1/decide와 확장 판정을 직접 비교
py tools/policy_parity.py    # 공용 케이스 표(40개)와 서버 기본 정책 대조
```
