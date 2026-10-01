# 브라우저 확장 프로그램 — AI 입력정보 보호 게이트웨이 (v1.1.0)

Chrome Manifest V3 확장 프로그램입니다. ChatGPT · Claude · Gemini의 텍스트 입력·붙여넣기에서 일부 개인정보 형식을 **로컬에서만** 검사하고, 사용자가 선택할 때만 마스킹합니다. 서버 전송·외부 요청·원격 코드가 없습니다.

## 파일 구성

소스는 이 폴더(`browser-extension/`)에 있고, 제출·설치용 확장은 빌드 산출물 `dist-ext/`입니다. **스토어에는 `dist-ext/`만 올립니다.**

| 파일 | 역할 |
|---|---|
| `manifest.json` | MV3 설정. 버전 1.1.0, 아이콘 4종, `options_page`, 백그라운드 서비스 워커, `storage` 권한, 대상 호스트 4개 |
| `src/engine/detector.ts` → `dist-ext/detector.js` | 로컬 정규식 탐지·마스킹. `inspect()`는 범주 ID 배열만, `mask()`는 자리표시자 대체 문자열만, `findMatches()`/`applyMatches()`는 일치 구간의 위치를 다룹니다 |
| `src/engine/policy.ts` → `dist-ext/policy.js` | 브라우저 안에서 도는 로컬 정책 엔진. `policy.py`와 같은 우선순위(BLOCK > REQUIRE_APPROVAL > MASK > ALLOW)와 같은 기본 매핑을 따릅니다 |
| `content.js` | 입력·붙여넣기 감지 → 안내 창 → 수동 마스킹. 실행 취소, 감사 기록, 선택형 전송 차단 |
| `src/background/background.ts` → `dist-ext/background.js` | 설치 시 시작 가이드 1회, 탭별 판정 배지 |
| `popup.html` · `options.html` · `onboarding.html` | 확장 페이지의 진입점. 비어 있는 `#root`에 `src/`의 React 화면을 붙입니다 |
| `src/popup/` | 도구 모음 팝업(React). 현재 탭의 지원 여부와 버전만 표시 |
| `src/options/` | 설정 화면(React). 탐지 4종 on/off, 안내 표시·실행 취소, 감사 기록 보기/삭제, 전송 보호 스위치 |
| `src/onboarding/` | 설치 직후 열리는 60초 시작 가이드(React) |
| `src/entries/` | `detector.js`·`policy.js`의 진입점. 전역 `AIInputGatewayDetector`·`AIInputGatewayPolicy`를 노출합니다(`content.js`가 이 이름으로 접근) |
| `src/shared/` | 화면·백그라운드가 공유하는 상수·설정 읽기/쓰기·호스트 판별. `consistency.test.ts`가 `content.js`·`background.js`·`manifest.json`의 같은 값과 대조합니다 |
| `src/test/` | 테스트용 `chrome.*` 스텁, 빌드 산출물을 vm에서 실행하는 도우미 |
| `icons/logo.svg` · `icon16/32/48/128.png` | 최종 로고(A안). PNG는 `py tools/make_icons.py`로 생성 |

`detector.js` · `policy.js` · `background.js`는 TypeScript 소스(`src/`)를 **하나의 일반 스크립트(IIFE)로 번들**해 같은 이름으로 `dist-ext/`에 만듭니다. `manifest.json`의 `content_scripts`와 서비스 워커는 모듈이 아닌 일반 스크립트로 읽으므로 ES 모듈로 내지 않고, 읽기 쉽도록 압축하지 않습니다. `content.js`는 아직 TS로 옮기지 않아 **내용을 바꾸지 않은 채 그대로 복사**합니다(`vite.config.mts`의 `STATIC_FILES`).

`docs/detector.js`(공개 데모가 읽는 파일)는 직접 고치지 않습니다. 빌드가 `dist-ext/detector.js`를 복사해 덮어쓰므로 탐지기 소스는 `src/engine/detector.ts` 하나입니다.

## 빌드·테스트

Node.js 20.19 이상이 필요합니다. 저장소 루트에서 실행합니다.

```bash
npm install          # 처음 한 번
npm run build        # 타입 검사 + dist-ext/ 생성
npm run dev          # 변경 감시 빌드 (chrome://extensions → 압축해제된 확장 → dist-ext/ 로드)
npm test             # 빌드 후 vitest 전체 (탐지기·정책·백그라운드·React 화면·산출물 검사)
py tools/package_store.py   # dist-ext/ → dist/ai-input-protection-gateway-<버전>.zip
```

`package_store.py`는 `dist-ext/`가 없으면 실패하고, 테스트·소스맵·TypeScript 소스가 섞여 있거나 HTML이 참조하는 파일이 없으면 ZIP을 만들지 않습니다.

## 탐지 결과 계약

검사는 NFKC 정규화 뒤 수행하므로 전각 숫자·하이픈 변형도 범주로 잡힐 수 있습니다. `inspect()`는 입력 원문이나 일치한 문자열 대신 아래 범주 ID 배열을 반환합니다. 화면에서는 이 ID를 한국어 이름과 PDP 데모 조치 안내로 바꿔 표시합니다.

| 범주 ID | 화면 표시 | PDP 데모 기본 조치 |
|---|---|---|
| `government_id` | 주민등록번호 형식 | `MASK` |
| `phone_number` | 전화번호 형식 | `MASK` |
| `email` | 이메일 형식 | `MASK` |
| `api_key` | API 키/토큰 형식 | `BLOCK` |

이 ID들은 `gateway-core/pdp/policy.py`의 정책 범주와 맞춥니다. `policy.js`는 그 정책을 브라우저 안에서 그대로 계산합니다(파이썬 PDP를 호출하지는 않습니다). 기본값으로는 **판정 결과를 안내 문구에만 쓰고 아무것도 막지 않습니다.** 전각 변형은 탐지를 우선하고, 마스킹은 원문 표기 그대로 치환을 시도한 뒤 필요하면 정규화 보기에서 가립니다.

## 1.1.0에서 바뀐 것

1.1.0은 1.0.0에서 "약속했지만 없던" 기능과, 감지 안내가 8초 뒤에 사라져 다음 입력을 놓치던 문제를 함께 고쳤습니다.

| 항목 | 기본값 | 설명 |
|---|---|---|
| 감지 안내 계속 표시 | 켜짐 | 감지 안내가 시간 경과로 사라지지 않습니다. 오른쪽 위 `×`로 닫을 수 있고, 닫으면 같은 감지가 이어지는 동안 다시 띄우지 않습니다. 감지된 값이 모두 사라지면 자동으로 닫히고(설정 가능), 같은 값이 다시 들어오면 다시 안내합니다. |
| 감지가 없으면 자동 닫기 | 켜짐 | 계속 떠 있던 감지 안내를 입력값이 깨끗해지는 시점에 닫습니다. |
| 실행 취소 | 켜짐 | 마스킹 결과 안내에 `실행 취소` 버튼이 붙습니다. 한 번만 되돌릴 수 있습니다. |
| 안내 위치 | 오른쪽 위 | 오른쪽 위 / 왼쪽 아래. |
| 감사 기록 | 꺼짐 | 판정 이름·범주 ID·시각만 최근 20건을 로컬에 남깁니다. **원문과 일치한 문자열은 저장하지 않습니다.** |
| 로컬 정책 적용 | 꺼짐 | `policy.js`의 판정을 안내 문구에 반영합니다. |
| 전송 차단 | 꺼짐 | 로컬 정책이 `BLOCK`인 값이 실린 채 보내기를 누르면 첫 시도를 중단합니다. |
| 승인 확인 단계 | 꺼짐 | 로컬 정책이 `REQUIRE_APPROVAL`이면 보내기 전에 확인을 요구합니다. |

막는 기능은 모두 꺼진 상태로 나옵니다. 화면 표시 방식만 바꾸는 항목(계속 표시, 자동 닫기, 실행 취소, 위치)만 켜져 있고, 이 확장은 **기본적으로 자동으로 막지 않는다는 원칙을 유지합니다.**

전송 차단을 켰을 때의 동작:

- 첫 전송 시도는 `preventDefault()`로 중단하고 무엇이 걸렸는지(범주 이름만) 알려 줍니다.
- **5초 안에 한 번 더 누르면 그대로 전송됩니다.** 눌린 입력 묶음에서 이어지는 `submit` 이벤트까지 함께 통과시키므로, "한 번 더 누르면 전송"이 실제로 성립합니다.
- 막으려고 하는 대상은 Enter 키, 폼 `submit`, 전송으로 보이는 버튼 클릭입니다. 폼 안의 버튼을 누르면 전송으로 보고, 폼 밖 버튼은 라벨에 `send`·`submit`·`보내기`·`전송`·`질문하기`가 있을 때만 전송으로 봅니다.
- 언제든 설정에서 끄면 즉시 원래대로 돌아갑니다.

설정은 `chrome.storage.local`의 `features` 한 곳에 모입니다. 기존 1.0.0 사용자에게는 `features` 키가 없으므로 기본값으로 채워집니다.

```json
{
  "features": {
    "persistentAlert": true,
    "autoCloseWhenClean": true,
    "resultAutoHideMs": 8000,
    "noticePosition": "top-right",
    "undoButton": true,
    "auditLog": false,
    "enforcePolicy": false,
    "blockSend": false,
    "requireConfirm": false
  }
}
```

`resultAutoHideMs`는 감지 안내가 아닌 결과·완료 안내에만 적용됩니다(0 이하 값은 8000ms로 되돌아갑니다).

## 감사 기록에 남는 것과 남지 않는 것

남는 것: 판정 이름(`BLOCK` 등), 범주 ID(`phone_number` 등), 시각. 최근 20건만.

남지 않는 것: 입력 원문, 일치한 문자열, 어떤 항목의 몇 번째인지와 같은 위치 정보. 저장된 값은 범주만으로 다시 설명할 수 없는 내용이 없습니다. 설정 화면의 "로컬 기록 전체 삭제"를 누르면 기록과 배지가 함께 지워집니다.

## 설정 연동

설정 화면(`src/options/`)이 `chrome.storage.local`에 `{ enabled: { government_id, phone_number, email, api_key } }`를 저장하고, `content.js`가 같은 키를 읽어 **끈 범주를 탐지와 마스킹에서 모두 제외**합니다.

```js
// 옵션을 주지 않으면 기존과 동일하게 4종 전체를 사용합니다(하위 호환).
detector.inspect(text);
detector.mask(text);
// 사용자가 끈 범주만 제외합니다.
detector.inspect(text, { disabledCategories: ["email"] });
detector.mask(text, { disabledCategories: ["email"] });
```

`contenteditable`에서는 문자열 대신 위치 정보를 씁니다. 일치 구간만 바꾸려면 위치가 필요하기 때문입니다.

```js
// 일치한 문자열은 담지 않고 범주 ID와 위치만 돌려줍니다.
const matches = detector.findMatches(text, { disabledCategories: ["email"] });
// matches를 적용한 결과 문자열을 만듭니다. mask()와 같은 결과가 나옵니다.
detector.applyMatches(text, matches);
```

`content.js`는 판정 이름(`ALLOW` / `MASK` / `REQUIRE_APPROVAL` / `BLOCK`)만 `background.js`에 메시지로 보내 배지 색을 정합니다. 원문과 범주 ID는 보내지 않습니다.

배지: 감지 없음 `#0e9f6e`(문자 없음) · 마스킹/승인 필요 `#b77900`(`!`) · 차단 권고 `#d92d20`(`!`)

## 수동 마스킹과 줄바꿈

- `input`과 `textarea`는 해당 입력 요소의 값만 갱신합니다.
- `contenteditable`에서는 **일치한 구간의 문자만** 바꿉니다. 문단 요소(`<p>`·`<div>`), `<br>`, 서식 요소, 나머지 텍스트 노드는 손대지 않으므로 줄 구조가 바뀌지 않습니다. 편집기 전체를 새 DOM으로 교체하지 않습니다.
- 마스킹 결과가 기존 DOM 구조에 안전하게 적용되는지 검사합니다. 예상 결과를 정확히 반영할 수 없으면 일부만 바꾸지 않고 갱신을 중단합니다.
- 입력 변경 이벤트 뒤 사이트가 값을 되돌렸는지도 확인합니다. 편집기 DOM을 직접 바꾸는 방식은 사이트 내부 상태나 커서·서식 보존을 보장할 수 없습니다. 버튼을 누른 뒤 화면의 전체 입력과 줄바꿈을 확인하고, 결과가 다르거나 입력이 사라졌다면 전송하지 마세요.
- 마스킹은 복원 가능한 토큰화가 아니라 일치한 문자열을 자리표시자로 대체하는 동작입니다.

### 줄이 하나씩 늘어나던 문제 (제출 전 수정)

증상: 여러 줄을 마스킹하면 줄 사이에 빈 줄이 생겼습니다.

```text
010-0000-0000        [전화번호]
000000-1000000  →    (빈 줄)          ← 잘못된 결과
                     [주민등록번호]
```

원인은 읽기 방식과 쓰기 방식의 불일치였습니다.

1. 읽을 때 `innerText`를 썼습니다. HTML 명세의 `innerText`는 `<p>` 요소 경계마다 줄바꿈을 **2개**로 계산합니다("If node is a `p` element, then append 2"). 그래서 ChatGPT·Claude·Gemini가 쓰는 문단 구조 `<p>a</p><p>b</p>`는 실제로는 2줄인데 `"a\n\nb"`로 읽혔습니다. (`<div>`나 `<br>` 구조는 줄바꿈 1개라 문제가 없었습니다.)
2. 쓸 때 편집기의 모든 자식을 지우고 `\n`을 `<br>`로 바꿔 다시 넣었습니다. 그래서 1번의 없던 `\n`이 `<br><br>`이 되어 진짜 빈 줄로 굳었습니다.

수정 내용:

- 읽기를 자체 구조 순회로 바꿨습니다. 블록 경계와 `<br>`을 각각 줄바꿈 **1개**로 세므로 사용자가 만든 줄 수와 일치합니다. `<p><br></p>` 같은 빈 문단은 `<br>` 덕분에 빈 줄로 남습니다.
- 쓰기를 위치 기반 치환으로 바꿨습니다. `findMatches()`가 준 구간의 문자만 바꾸므로 문단·줄바꿈·서식이 그대로 남고, 마스킹이 줄 수를 바꿀 수 없습니다.
- 달라진 동작: 전각 숫자처럼 원문 표기가 다른 값만 있고 그 위치를 원문에서 특정할 수 없으면, 전체 텍스트를 정규화해 덮어쓰지 않고 **입력란을 바꾸지 않은 채** 안내만 표시합니다. 구조를 지키는 쪽을 택한 결과입니다. `mask()`는 그대로이므로 데모 페이지(`docs/demo.html`)의 동작은 변하지 않습니다.

## 테스트 실행

프로젝트 루트에서 실행합니다. 먼저 빌드한 뒤 vitest가 돕니다.

```text
npm test
```

- `src/engine/detector.test.ts` · `policy.test.ts`: 같은 케이스를 **TS 모듈**과 **빌드된 `dist-ext/*.js`(빈 전역에서 실행)** 양쪽에 돌립니다. 탐지 범주, 원문 미반환, 전각 변형, 줄바꿈 보존, 설정에서 끈 범주 제외, `findMatches()`/`applyMatches()`와 `mask()`의 일치, 정책 우선순위·알 수 없는 범주 처리·원문 문자열 거부를 확인합니다.
- `src/background/background.test.ts`: 설치 시 시작 가이드, 배지 색·문자, 알 수 없는 판정 이름 처리를 모듈과 산출물 양쪽에서 확인합니다.
- `src/build-artifacts.test.ts`: `manifest.json`이 가리키는 파일이 모두 있는지, 일반 스크립트에 `import`/`export`가 없는지, `content.js`가 원본과 같은지, `docs/detector.js`가 확장에 들어가는 것과 같은지 확인합니다.
- `src/**/*.test.tsx`: popup·options·onboarding 화면. `src/shared/consistency.test.ts`는 `content.js`·`manifest.json`과 겹치는 값(기본 설정, 지원 호스트)이 어긋나는지 대조합니다.

`contenteditable`의 DOM 조작은 실제 브라우저에서만 확인할 수 있습니다. 로컬 Chrome을 헤드리스로 띄워 확장 코드를 그대로 실행하는 회귀 테스트가 있습니다.

```text
npm run build
py tools/dom_test.py
```

하네스는 소스가 아니라 빌드 산출물(`dist-ext/`)을 읽습니다. 알림 창의 마스킹 버튼까지 실제로 눌러 결과 DOM 구조와 화면에 그려진 줄 수를 비교합니다. `<p>`·`<div>`·`<br>` 세 가지 줄 구조, 5줄 예시, 빈 줄 유지, 한 줄에 값이 여러 개인 경우, 값이 여러 인라인 요소에 나뉜 경우 등 16개를 확인하고, 이어서 1.1.0 기능 28개를 확인합니다. 시간 검사는 Chrome의 가상 시간(`--virtual-time-budget`)으로 도는 덕분에 20초 유지와 8초 자동 닫힘을 확인해도 실제 실행은 몇 초면 끝납니다. Chrome 실행 파일을 자동으로 찾지 못하면 `--chrome` 옵션으로 지정합니다.

파이썬 쪽 정책과 브라우저 쪽 정책이 같은 답을 내는지 확인합니다.

```text
py tools/policy_parity.py          # policy.py ↔ policy.ts 같은 케이스 12개 대조(Python 쪽 확인)
py -m pytest gateway-core/pdp -q   # 정책 엔진 자체 테스트
```

`tools/policy_cases.json`이 양쪽이 공유하는 케이스 표입니다. 어느 한쪽만 고쳐도 대조 테스트가 실패합니다.

## 제출 패키지 만들기

```text
npm run build
py tools/package_store.py
```

`dist/ai-input-protection-gateway-<버전>.zip`이 생성됩니다. `dist-ext/`만 담으며, 테스트·소스맵·TypeScript 소스가 섞여 있거나 HTML이 참조하는 파일 또는 `manifest.json`이 참조하는 아이콘이 없으면 ZIP을 만들지 않습니다. ZIP 항목 경로는 항상 `/` 구분자입니다.

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

4. 수동 마스킹 버튼을 누른 뒤, 다섯 줄이 유지되고 감지된 네 값만 `[주민등록번호]`, `[전화번호]`, `[이메일]`, `[API 키/토큰]`으로 바뀌는지 확인합니다. **줄 사이에 빈 줄이 생기면 안 됩니다.** 마지막 문장도 남아 있어야 합니다. 줄바꿈이 사라지거나 웹페이지가 원래 내용으로 되돌리면 입력을 전송하지 마세요.
5. 설정에서 특정 항목을 끄고 같은 문구를 다시 입력해, 안내와 마스킹에서 빠지는지 확인합니다.

## 제한

- 정규식은 일부 문자열 형식만 찾습니다. 미감지는 안전 판정이 아닙니다.
- 확장 프로그램은 입력을 서버에 보내지 않지만, 대상 웹사이트 자체의 입력 처리는 별개입니다.
- 브라우저 범주 ID와 파이썬 정책의 이름은 맞췄고 `policy.js`가 같은 판정을 내지만, 실제 정책 호출이 없으므로 조직의 PDP 서버가 정한 정책과 일치한다는 보장은 없습니다. 브라우저와 PDP 사이의 HTTP API/메시지 연결은 아직 없습니다. 다음 연동 단계에서도 원문이 아니라 범주 ID만 전달하도록 해야 합니다.
- **기본값으로는 아무것도 막지 않습니다.** 전송 차단·승인 확인은 사용자가 직접 켜야 동작하며, 끄면 즉시 원래대로 돌아갑니다.
- 전송 차단을 켜도 첫 시도만 막고 5초 안에 다시 누르면 전송됩니다. 확실한 차단이 필요하면 사이트에서 직접 확인해야 합니다.
- 세션 토큰 마스킹(서버 응답을 붙여 되돌리는 방식)은 다음 버전 범위입니다. 현재 마스킹은 자리표시자로의 대체이며 되돌리기는 직전 한 번의 `실행 취소`로만 가능합니다.
- 스토어 등재 문안과 개인정보 처리방침은 `docs/store-listing.md`, `docs/privacy.html`을 보세요.
