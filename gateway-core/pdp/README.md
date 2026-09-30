# PDP MVP — 로컬 정책 판정기

PDP는 쉽게 말해 “무슨 조치를 할지 정하는 판단기”입니다. 이 폴더의 Python 코드는 입력 원문이 아니라 `government_id` 같은 탐지 범주 ID만 받아 데모 정책을 판정합니다.

## 꼭 있어야 하는 파일

```text
gateway-core/pdp/
├── policy.py       # 정책과 판정 함수
├── test_policy.py  # 자동 테스트 7개
└── README.md       # 이 안내 문서
```

`policy.py`와 `test_policy.py`는 실제 Python 코드 파일입니다. README만 있거나 폴더가 비어 있으면 테스트가 발견되지 않습니다.

## 현재 데모 정책

- 탐지 범주 없음 → `ALLOW`
- `government_id`, `phone_number` → `MASK`
- `api_key` → `BLOCK`
- 정책에 등록되지 않은 범주 → `REQUIRE_APPROVAL`
- 여러 범주가 있으면 더 엄격한 조치를 선택: `BLOCK` > `REQUIRE_APPROVAL` > `MASK` > `ALLOW`

이는 동작 예시일 뿐, 실제 조직에 적용할 최종 보안 정책이 아닙니다. 이 Python 모듈은 조치 이름을 반환할 뿐 브라우저 전송을 막거나 실제 마스킹을 실행하지 않습니다.

## 브라우저 탐지기와 범주 ID 맞추기

`browser-extension/detector.js`의 `inspect()`는 아래 ID만 결과로 반환하도록 맞췄습니다. 같은 ID가 `policy.py`의 기본 정책에서 사용됩니다.

| 범주 ID | 브라우저에서 표시하는 이름 | PDP 데모 조치 |
|---|---|---|
| `government_id` | 주민등록번호 형식 | `MASK` |
| `phone_number` | 전화번호 형식 | `MASK` |
| `api_key` | API 키/토큰 형식 | `BLOCK` |

향후 HTTP 연결을 만들 때 사용할 수 있는 원문 없는 요청 모양은 다음과 같습니다.

```json
{"detected_categories": ["government_id", "phone_number"]}
```

**현재는 예시 계약일 뿐입니다.** PDP는 아직 HTTP API를 제공하지 않고, 확장 프로그램도 이 요약을 서버에 보내거나 Python PDP를 호출하지 않습니다. 연결을 구현할 때도 입력 원문, 탐지된 문자열, 편집기 내용은 요청에 넣지 않아야 합니다.

## 테스트 실행

터미널의 현재 위치를 프로젝트 루트로 맞춘 뒤 실행합니다. 프로젝트 루트는 `browser-extension`과 `gateway-core` 폴더가 함께 보이는 위치입니다.

```text
python -m unittest discover -s gateway-core/pdp -p "test_*.py" -v
```

Windows에서 `python` 명령이 인식되지 않으면 다음을 사용합니다.

```text
py -m unittest discover -s gateway-core/pdp -p "test_*.py" -v
```

정상적으로 7개 테스트를 찾으면 결과 마지막 부분에 `Ran 7 tests`와 `OK`가 표시됩니다.

### 최근 검증 기록

사용자가 로컬 실행에서 `Ran 7 tests in 0.001s`가 출력됐고 테스트가 통과했다고 확인했습니다. 이는 사용자 보고를 기록한 것이며, 이 작업공간에서 명령을 직접 실행하거나 재검증한 결과는 아닙니다. 코드를 수정한 뒤에는 위 명령으로 다시 확인해 주세요.

## `Ran 0 tests`가 나오면

`Ran 0 tests`는 테스트가 통과했다는 뜻이 아니라, 실행기가 조건에 맞는 테스트 파일을 하나도 찾지 못했다는 뜻입니다.

1. 먼저 프로젝트 루트에서 실행 중인지 확인합니다.
2. `gateway-core/pdp/` 안에 `policy.py`와 `test_policy.py`가 실제로 있는지 확인합니다. `test_policy.py.txt`처럼 끝에 `.txt`가 붙으면 안 됩니다.
3. 테스트 파일 이름이 `test_`로 시작하는지 확인합니다.
4. 발견 명령 대신 테스트 파일을 직접 실행해 볼 수 있습니다.

```text
python gateway-core/pdp/test_policy.py -v
```

Windows에서는 다음 명령도 사용할 수 있습니다.

```text
py gateway-core/pdp/test_policy.py -v
```

이 직접 실행도 실패한다면 오류 문구 전체를 확인해야 합니다. 프로젝트 루트의 `gateway-core/pdp/test_policy.py`와 `gateway-core/pdp/policy.py`가 현재 작업공간에 있으므로, 사용 중인 로컬 폴더에 파일이 없다면 해당 파일을 같은 상대 경로로 복사하거나 프로젝트 파일을 동기화해 주세요.

## 현재 범위와 한계

- 정책 판정 입력은 범주 ID뿐이며, 입력 원문은 받지 않습니다.
- 브라우저 확장 프로그램, 탐지기, API 서버와 아직 실제로 연결되지 않았습니다. 지금 완료된 것은 범주 ID 명칭을 일치시킨 단계입니다.
- `MASK`는 조치 이름을 반환할 뿐 실제 마스킹을 수행하지 않습니다.
- `REQUIRE_APPROVAL`은 승인 요청을 보내지 않고 `BLOCK`도 웹 전송을 막지 않습니다.
- 데이터 저장, 네트워크 통신, 사용자 인증 기능은 없습니다.
- 테스트가 통과하더라도 이 독립형 정책 예제가 실제 서비스 보안을 보장하지는 않습니다.
