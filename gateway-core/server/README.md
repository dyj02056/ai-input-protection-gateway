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
| `PDP_ADMIN_KEYS_SHA256` / `PDP_ADMIN_KEYS` | 관리자 키(일반 키와 다른 값): 감사 로그 조회, 승인 처리, 정책 버전 관리, 콘솔 로그인. `py tools/server.py newkey --admin` |
| `PDP_DATA_DIR` | 콘솔로 만든 정책 버전·승인 요청·관리 기록 폴더. 기본 `server/data/`(커밋되지 않음) |
| `PDP_APPROVAL_TTL_MINUTES` | 승인 요청이 처리되지 않고 만료되기까지. 기본 240(4시간) |
| `PDP_APPROVAL_VALID_MINUTES` | 승인된 뒤 한 번 쓸 수 있는 기간. 기본 30 |
| `PDP_AUDIT_DIR` | 감사 로그 폴더. 기본 `server/audit_data/`(커밋되지 않음) |
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
| `POST /v1/audit` | 감사 이벤트 수집(최대 50건 묶음, 본문 32KB). 해시 체인으로 추가 전용 저장, 같은 `event_id`는 한 번만. 일반 API 키 |
| `GET /v1/audit?after=&limit=` · `/v1/audit/head` · `/v1/audit/verify` | 기록 읽기·마지막 번호와 해시·체인 검증. **관리자 키 전용** |
| `POST /v1/approvals` | 승인 요청 만들기(`categories`·`purpose`·`note`만, 모르는 필드는 422). 일반 API 키. 같은 키의 대기 건은 50개까지 |
| `GET /v1/approvals/{id}` · `POST /v1/approvals/{id}/consume` | 내가 만든 요청의 상태 · 승인된 요청을 한 번 사용(이후 409). 일반 API 키, 다른 키의 요청은 404 |
| `GET /v1/approvals?status=&limit=` · `POST /v1/approvals/{id}/decision` | 승인 요청 목록 · `{"decision":"approve"\|"reject","note":""}`로 처리. **관리자 키 전용**, 요청한 키와 같은 이름의 관리자 키는 403 |
| `GET /v1/admin/policies` · `POST /v1/admin/policies` · `POST /v1/admin/policies/{version}/activate` | 정책 버전 목록 · 새 버전 만들기(`activate:true`면 바로 적용) · 이 버전을 활성으로(롤백). **관리자 키 전용** |
| `GET /v1/admin/events` · `/v1/admin/events/verify` | 정책 변경·승인 처리 기록(해시 체인)과 검증. **관리자 키 전용** |
| `GET /console` | 관리 콘솔 화면(정적). 데이터는 위 API로만 가져옵니다 |
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

**콘솔로 만든 버전**은 `policy_files/`가 아니라 `PDP_DATA_DIR/policies/policy.v{N}.json`에 저장되고(기본 정책 파일은 건드리지 않습니다), 활성 버전은 `PDP_DATA_DIR/active.json`에 저장돼 서버를 다시 시작해도 유지됩니다. 활성 버전은 이 파일이 `PDP_ACTIVE_POLICY_VERSION`보다 우선합니다(콘솔이 가장 최근 결정이므로). 버전은 만든 뒤 바꾸지 않고, 정책 변경은 새 버전 만들기 → 활성화, 롤백은 이전 버전 활성화입니다. 모든 변경은 관리 기록(`admin_events.jsonl`)에 해시 체인으로 남습니다. **비밀·결제 정보(`api_key`·`credit_card`·`password`)는 새 버전에서도 BLOCK보다 약하게 둘 수 없습니다**(계획서의 `non_overridable`).

## 승인 워크플로

`REQUIRE_APPROVAL` 판정을 받은 사용자가 확장에서 승인을 요청하면(`PENDING`) 관리자가 콘솔에서 승인 또는 거절합니다. 상태는 `PENDING → APPROVED | REJECTED | EXPIRED → CONSUMED`입니다.

- 서버가 저장하는 것: 범주 ID, 채널, 업무 목적(고정 선택지 5개), 짧은 메모(100자), 요청한 키 이름, 시각. **입력 원문·파일 이름·내용 해시는 받지 않습니다**(스키마가 거절). 내용이 같은지 비교는 확장이 자기 탭 안에서만 합니다.
- 승인은 **한 번만** 씁니다. 확장이 승인을 확인하면 곧바로 `consume`을 불러 `CONSUMED`로 만들고, 이후 같은 승인은 409입니다. 승인된 뒤 `PDP_APPROVAL_VALID_MINUTES`가 지나면 만료됩니다.
- 요청한 키와 같은 이름의 관리자 키로는 승인할 수 없습니다(자기 승인 금지). 대기 중인 요청이 처리 없이 `PDP_APPROVAL_TTL_MINUTES`를 넘기면 만료됩니다.
- 저장은 `PDP_DATA_DIR/approvals.json`(통째로 바꿔 쓰기)입니다. 완료된 요청은 90일 뒤 지웁니다. 파일이 깨져 있으면 서버가 시작하지 않습니다.
- 한계: API 키가 조직당 하나라 "누가 요청했는지"는 키 이름 수준입니다. 승인자 역할(팀장·CPO)·에스컬레이션·Slack/Teams 알림은 이후 단계입니다.

## 관리 콘솔

`http://127.0.0.1:8787/console`에서 **관리자 키**로 로그인합니다(일반 API 키는 거부됩니다). 빌드 도구 없이 서버가 정적 파일(`console/`)을 내려주고, 화면은 위의 `/v1` API만 호출합니다.

| 탭 | 기능 |
|---|---|
| 승인함 | 대기·처리 요청 목록(감지 범주·목적·메모·상태), 건별 승인·거절(일괄 처리 없음), 15초마다 자동 갱신, 대기 건수 표시 |
| 정책 | 버전 목록(활성 표시), 현재 활성 정책에서 시작하는 새 버전 양식(변경 요약 확인 후 생성, 바로 적용 선택), 이전 버전으로 되돌리기 |
| 감사 로그 | 확장이 보낸 이벤트(최근 100건), 마지막 번호·해시 표시, 체인 검증 |
| 관리 기록 | 정책 변경·승인 처리 기록(최근 100건), 체인 검증 |

화면 보안: 관리자 키는 스크립트 메모리에만 두고 저장하지 않으며(새로고침하면 다시 입력) 이 서버로만 보냅니다. 서버가 준 모든 값은 `textContent`로만 그립니다(요청자가 쓴 메모가 HTML로 해석되지 않음). 콘솔 응답에는 `Content-Security-Policy`(같은 출처 스크립트·스타일만, `frame-ancestors 'none'`)가 붙고, `console.js`에 `innerHTML`·`eval`·`localStorage` 등이 없는지 테스트가 검사합니다.

## 감사 로그와 해시 체인

각 기록은 `hash = SHA-256(이전 hash + 줄바꿈 + 본문의 정규화 JSON)`이고 처음 기록의 이전 값은 `0`×64입니다. 중간 기록을 고치거나 지우거나 순서를 바꾸면 이후 해시가 모두 어긋나 `/v1/audit/verify`가 **처음 깨진 번호**를 알려 줍니다. 시작할 때도 검증하며, 깨져 있으면 서버가 시작하지 않습니다. 기록에는 호출자 이름, 서버가 받은 시각, 이벤트(시각·조치·범주 ID·채널·정책 버전)만 있고 원문·파일 이름·주소는 없습니다.

**한계**: 파일을 쓸 수 있는 사람이 체인 전체를 다시 계산해 덮어쓰면 서버만으로는 알 수 없습니다. `GET /v1/audit/head`의 `seq`·`hash`를 서버 밖(다른 시스템·문서)에 주기적으로 남겨 두어야 변조를 확실히 잡습니다. 파일 하나·단일 프로세스(쓰기 잠금)라 규모가 커지면 DB와 외부 앵커링이 필요합니다. 보관 기간·삭제 정책은 없습니다.

## 보안 설계

- 키 비교는 `hmac.compare_digest`(상수 시간)로 모든 키를 같은 방식으로 돌립니다. 서버는 키의 SHA-256만 메모리에 둡니다.
- `/docs`·`/openapi.json`은 끕니다. 응답에 `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- 요청 본문 상한(413), 범주 ID는 `^[a-z][a-z0-9_]{0,63}$`, 목록 32개·행 수 상한, `extra="forbid"`.
- 로그에는 호출자 이름·채널·범주 **개수**·조치·정책 버전만 남기고 범주 ID나 내용은 남기지 않습니다.
- 확장은 이 서버에 **입력 내용·파일을 보내지 않습니다**. 정책을 내려받는 것이 기본이고, 사용자가 별도 동의 스위치를 켠 경우에만 감사 이벤트(범주 ID·조치·시각)와 승인 요청(범주 ID·목적·짧은 사유)을 보냅니다.
- 관리자 키가 있어야 하는 API(감사 읽기·승인 처리·정책 변경)는 일반 API 키를 거부하고, 일반 키가 필요한 API(수집·승인 요청)는 관리자 키를 거부합니다.

## 운영 전에 해야 할 일 (이 서버가 하지 않는 것)

1. **HTTPS**: 이 서버는 TLS를 직접 처리하지 않습니다. 인증서를 쓰는 역방향 프록시 뒤에 두세요. 확장은 원격 http 주소를 거부합니다.
2. **속도 제한·IP 제한**: 키 대입 공격을 막으려면 프록시나 방화벽에서 제한하세요.
3. **키 관리**: 키는 조직당 하나이며 사용자별 구분·만료·폐기 이력이 없습니다. SSO·사용자별 키는 이후 단계입니다.
4. **정책 변경 권한**: 관리자 키를 가진 사람이 곧 정책 관리자입니다(역할 구분·변경 승인 절차 없음). 변경 이력은 관리 기록에 남지만, 위 감사 로그와 같이 `head`를 서버 밖에 남겨 두어야 체인 전체 재계산 변조를 잡을 수 있습니다. 콘솔 화면을 HTTPS 없이 원격에 열지 마세요(관리자 키가 평문으로 오갑니다).
5. **가용성**: 서버가 멈춰도 확장은 이전 정책으로 계속 판정합니다. 다만 정책 변경이 늦게 퍼집니다(사이트를 열 때 확인, 10분 간격).

## 시험

```bash
py tools/server.py test      # 서버 단위 시험 84개 (승인·정책 버전·관리 기록·콘솔 화면 37개 포함)
py tools/server.py e2e       # 서버를 임시 키로 띄워 확장 코드와 실제 HTTP로 연결(13개: 정책 동기화 6 + 감사 전송 3 + 승인 4). /v1/decide와 확장 판정을 직접 비교
py tools/policy_parity.py    # 공용 케이스 표(40개)와 서버 기본 정책 대조
```
