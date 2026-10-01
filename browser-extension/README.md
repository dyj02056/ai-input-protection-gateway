# 브라우저 확장 프로그램 — AI 입력정보 보호 게이트웨이 (v1.0.0)

Chrome Manifest V3 확장 프로그램입니다. ChatGPT · Claude · Gemini의 텍스트 입력·붙여넣기에서 일부 개인정보 형식을 **로컬에서만** 검사하고, 사용자가 선택할 때만 마스킹합니다. 서버 전송·외부 요청·원격 코드가 없습니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `manifest.json` | MV3 설정. 버전 1.0.0, 아이콘 4종, `options_page`, 백그라운드 서비스 워커, `storage` 권한, 대상 호스트 4개 |
| `detector.js` | 로컬 정규식 탐지·마스킹. `inspect()`는 범주 ID 배열만, `mask()`는 자리표시자 대체 문자열만 반환 |
| `content.js` | 입력·붙여넣기 감지 → 안내 창 → 수동 마스킹. 설정에서 끈 범주는 탐지·마스킹에서 제외 |
| `background.js` | 설치 시 시작 가이드 1회, 탭별 판정 배지 |
| `popup.html` / `popup.css` / `popup.js` | 도구 모음 팝업. 현재 탭의 지원 여부만 표시 |
| `options.html` / `options.js` | 탐지 4종 on/off, 마스킹 방식(자리표시자), 로컬 기록 삭제 |
| `onboarding.html` | 설치 직후 열리는 60초 시작 가이드 |
| `icons/logo.svg` · `icon16/32/48/128.png` | 최종 로고(A안). PNG는 `py tools/make_icons.py`로 생성 |
| `detector.test.js` | Node.js 내장 테스트 8개 (개발용, 제출 ZIP에서 제외) |

## 탐지 결과 계약

검사는 NFKC 정규화 뒤 수행하므로 전각 숫자·하이픈 변형도 범주로 잡힐 수 있습니다. `inspect()`는 입력 원문이나 일치한 문자열 대신 아래 범주 ID 배열을 반환합니다. 화면에서는 이 ID를 한국어 이름과 PDP 데모 조치 안내로 바꿔 표시합니다.

| 범주 ID | 화면 표시 | PDP 데모 기본 조치 |
|---|---|---|
| `government_id` | 주민등록번호 형식 | `MASK` |
| `phone_number` | 전화번호 형식 | `MASK` |
| `email` | 이메일 형식 | `MASK` |
| `api_key` | API 키/토큰 형식 | `BLOCK` |

이 ID들은 `gateway-core/pdp/policy.py`의 정책 범주와 맞춥니다. 안내문에는 위 조치를 표시하지만, 아직 Python PDP를 호출하지 않으므로 위 조치가 브라우저에서 적용되는 것은 아닙니다. 특히 현재 `BLOCK`은 전송을 막지 않습니다. 전각 변형은 탐지를 우선하고, 마스킹은 원문 표기 그대로 치환을 시도한 뒤 필요하면 정규화 보기에서 가립니다.

## 설정 연동

`options.js`가 `chrome.storage.local`에 `{ enabled: { government_id, phone_number, email, api_key } }`를 저장하고, `content.js`가 같은 키를 읽어 **끈 범주를 탐지와 마스킹에서 모두 제외**합니다.

```js
// 옵션을 주지 않으면 기존과 동일하게 4종 전체를 사용합니다(하위 호환).
detector.inspect(text);
detector.mask(text);
// 사용자가 끈 범주만 제외합니다.
detector.inspect(text, { disabledCategories: ["email"] });
detector.mask(text, { disabledCategories: ["email"] });
```

`content.js`는 판정 이름(`ALLOW` / `MASK` / `REQUIRE_APPROVAL` / `BLOCK`)만 `background.js`에 메시지로 보내 배지 색을 정합니다. 원문과 범주 ID는 보내지 않습니다.

배지: 감지 없음 `#0e9f6e`(문자 없음) · 마스킹/승인 필요 `#b77900`(`!`) · 차단 권고 `#d92d20`(`!`)

## 수동 마스킹과 줄바꿈

- `input`과 `textarea`는 해당 입력 요소의 값만 갱신합니다.
- `contenteditable`에서는 Shift+Enter가 만든 `<br>`이나 문단 요소를 유지하고, 감지 문자열이 있는 기존 텍스트 노드만 바꿉니다. 편집기 전체를 새 DOM으로 교체하지 않습니다.
- 마스킹 결과가 기존 DOM 구조에 안전하게 적용되는지 검사합니다. 예상 결과를 정확히 반영할 수 없으면 일부만 바꾸지 않고 갱신을 중단합니다.
- 입력 변경 이벤트 뒤 사이트가 값을 되돌렸는지도 확인합니다. 편집기 DOM을 직접 바꾸는 방식은 사이트 내부 상태나 커서·서식 보존을 보장할 수 없습니다. 버튼을 누른 뒤 화면의 전체 입력과 줄바꿈을 확인하고, 결과가 다르거나 입력이 사라졌다면 전송하지 마세요.
- 마스킹은 복원 가능한 토큰화가 아니라 일치한 문자열을 자리표시자로 대체하는 동작입니다.

## 테스트 실행

프로젝트 루트에서 Node.js 내장 테스트 실행:

```text
node --test browser-extension/detector.test.js
```

외부 npm 패키지는 필요하지 않습니다. 탐지 범주, 원문 미반환, 이메일 마스킹, 전각 변형 탐지, 기본 마스킹과 문자열 수준의 줄바꿈 보존, 설정에서 끈 범주 제외, 옵션 미지정 시 하위 호환까지 8개를 확인합니다. 실제 ChatGPT·Claude 편집기의 DOM 표시나 내부 상태는 자동 테스트가 대신 확인하지 않으므로 Chrome에서 별도로 확인해야 합니다.

## 제출 패키지 만들기

```text
py tools/package_store.py
```

`dist/ai-input-protection-gateway-<버전>.zip`이 생성됩니다. `detector.test.js`, `README.md`, 미사용 시안(`logo-a/b/c.svg`)은 제외하고, `manifest.json`이 참조하는 아이콘이 실제로 있는지 먼저 검사합니다. ZIP 항목 경로는 항상 `/` 구분자입니다.

아이콘을 다시 만들려면:

```text
py tools/make_icons.py
```

`browser-extension/icons/icon16|32|48|128.png`가 다시 생성됩니다(16px는 내부 링을 빼고 `>` 셰브론만 남긴 단순화 버전).

## Chrome에서 간단히 확인

1. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드**로 `browser-extension/`을 선택합니다.
2. 설치 직후 열리는 시작 가이드를 확인하고, ChatGPT 또는 Claude 탭을 엽니다.
3. 아래 가짜 문구를 입력합니다. **실제 개인정보나 키는 사용하지 말고 전송하지 마세요.**

   ```text
   가짜 주민번호 000000-1000000
   가짜 전화번호 010-0000-0000
   가짜 이메일 test.user@example.com
   가짜 키 sk-TESTTESTTESTTESTTEST
   그대로 남아야 할 문장
   ```

4. 수동 마스킹 버튼을 누른 뒤, 다섯 줄이 유지되고 감지된 네 값만 `[주민등록번호]`, `[전화번호]`, `[이메일]`, `[API 키/토큰]`으로 바뀌는지 확인합니다. 마지막 문장도 남아 있어야 합니다. 줄바꿈이 사라지거나 웹페이지가 원래 내용으로 되돌리면 입력을 전송하지 마세요.
5. 설정에서 특정 항목을 끄고 같은 문구를 다시 입력해, 안내와 마스킹에서 빠지는지 확인합니다.

## 제한

- 정규식은 일부 문자열 형식만 찾습니다. 미감지는 안전 판정이 아닙니다.
- 확장 프로그램은 입력을 서버에 보내지 않지만, 대상 웹사이트 자체의 입력 처리는 별개입니다.
- 브라우저 범주 ID와 Python PDP의 이름은 맞췄지만, 실제 정책 호출이 없으므로 현재 확장 프로그램은 PDP 조치를 따르지 않습니다.
- 입력·전송을 자동 차단하지 않습니다. 브라우저와 PDP 사이의 HTTP API/메시지 연결도 아직 없습니다. 다음 연동 단계에서도 원문이 아니라 범주 ID만 전달하도록 해야 합니다.
- 스토어 등재 문안과 개인정보 처리방침은 `docs/store-listing.md`, `docs/privacy.html`을 보세요.
