## 현재 코드 구조와 동작

- `browser-extension/manifest.json`: Chrome Manifest V3 설정. 버전 `0.5.2`; ChatGPT·Claude 대상 사이트에만 콘텐츠 스크립트를 등록한다.
- `browser-extension/detector.js`: 일부 주민등록번호·전화번호·API 키/토큰 형식을 로컬에서 찾는다. `inspect()`는 원문이나 일치 문자열 대신 PDP와 공유하는 범주 ID 배열만 반환한다. 사용자가 선택한 경우 `mask()`가 일치 부분을 유형별 자리표시자로 바꾸며, 문자열 수준에서는 주변 텍스트와 줄바꿈을 유지한다.
- `browser-extension/content.js`: 입력·붙여넣기 뒤 탐지기를 호출하고, 범주 ID를 한국어 안내 이름으로 변환한다. 사용자가 마스킹 버튼을 눌렀을 때만 입력을 변경한다. `input`·`textarea`는 값과 `input` 이벤트를 갱신한다. contenteditable 편집기는 기존 DOM을 통째로 재구성하지 않고 텍스트 노드만 바꿔 줄바꿈·문단·서식 구조를 가능한 한 보존한다. 마스킹 결과가 편집기 전체 텍스트와 일치하지 않으면 되돌리며, 이벤트 처리 후 웹페이지가 값을 다시 바꿨는지 확인한다. 브라우저마다 편집기 내부 상태가 다르므로 수정 후 Chrome 확인이 필요하다.
- `browser-extension/detector.test.js`: 범주 ID, 원문 미반환, 기본 마스킹 및 줄바꿈을 포함한 문자열 변환을 확인하는 Node.js 내장 테스트 5개가 작성되어 있다. 앞선 4개 테스트는 사용자가 통과를 보고했지만, 이번 수정 뒤 5개 묶음의 재실행 결과는 아직 없다. 이 테스트는 실제 contenteditable DOM을 검증하지 않는다.
- `browser-extension/README.md`: 탐지 범주 계약, 기존 contenteditable 구조를 유지하는 마스킹 방식, 테스트 및 브라우저 확인 절차를 설명한다.
- `gateway-core/pdp/policy.py`: 원문이 아닌 범주 ID로 조치를 판정한다. 기본 데모 정책은 범주 없음 → `ALLOW`, `government_id`·`phone_number` → `MASK`, `api_key` → `BLOCK`, 미등록 범주 → `REQUIRE_APPROVAL`이다. 여러 결과가 있으면 우선순위 `BLOCK` > `REQUIRE_APPROVAL` > `MASK` > `ALLOW`로 더 엄격한 조치를 선택한다.
- `gateway-core/pdp/test_policy.py`: 표준 라이브러리 `unittest` 기반 PDP 테스트 7개.
- `gateway-core/pdp/README.md`: 실행 방법과 브라우저/PDP 사이의 원문 없는 범주 ID 계약을 설명한다. JSON 예시는 향후 API 모양의 참고용이며 지금은 서버가 없다.

## 현재 한계 및 개인정보 주의

- 정규식은 일부 형식만 다루므로 오탐·누락이 있다. 감지되지 않았다고 안전한 것은 아니다.
- 확장 프로그램은 입력을 서버에 보내지 않지만, 대상 웹사이트 자체의 입력 처리와는 별개다.
- 자리표시자 마스킹은 원래 값을 복원할 수 없는 대체이며 Token Vault 기반 토큰화가 아니다.
- 기존 contenteditable DOM의 텍스트 노드만 수정해도 사이트가 비동기 렌더링으로 내용을 되돌리거나, 커서·편집기 상태를 바꿀 수 있다. 마스킹 이후 화면의 줄바꿈과 전체 문구가 기대 결과와 일치하는지 확인하고, 다르면 전송하지 않는다.
- 브라우저 범주 ID와 Python PDP의 이름은 맞췄지만, 실제 정책 호출이 없으므로 현재 확장 프로그램은 PDP 조치를 따르지 않는다.
- `BLOCK`은 정책 판정 결과 이름일 뿐, 지금 웹사이트의 제출·전송을 막지 않는다. 실제 개인정보나 키 대신 가짜 테스트 문구만 사용하고 전송하지 않는다.

## 이번 단위에서 배울 개념

- `contenteditable`은 일반 입력창처럼 문자열 값만 바꾸는 구조가 아니다. 웹페이지가 만든 DOM 요소와 편집기 내부 상태가 함께 작동한다.
- 기존 편집기 전체를 새 DOM으로 교체하면 Shift+Enter로 만들어진 `<br>`이나 문단 구조가 사라질 수 있다. 마스킹할 텍스트 노드만 바꾸면 그 구조를 더 잘 보존할 수 있다.
- 문자열 수준의 줄바꿈 테스트는 브라우저 편집기의 DOM 및 사이트 상태를 검증하지 않는다. 실제 브라우저에서 별도로 확인해야 한다.
- 입력 이벤트를 발생시킨 뒤 사이트가 변경 내용을 반영하는지 확인하지 않으면 마스킹이 적용됐다고 단정할 수 없다.
- ID 이름을 맞춘 것과 실제 네트워크/API 연동은 다른 단계다. 이번 수정으로 PDP 서버 호출이 생긴 것은 아니다.

## 다음 체크포인트

1. 변경된 `browser-extension/content.js`, `manifest.json`, `README.md`와 이 진행 기록을 로컬 프로젝트에 반영한다. 파일이 자동으로 동기화되지 않을 수 있다.
2. Chrome의 `chrome://extensions`에서 확장 프로그램을 새로고침하고 대상 ChatGPT 또는 Claude 탭도 새로고침한다.
3. 민감하지 않은 가짜 문구로 Shift+Enter 줄바꿈이 마스킹 전후에 유지되는지 확인한다. 감지된 값만 자리표시자로 바뀌고 나머지 문장도 남아야 한다. 실제 정보를 쓰거나 입력을 전송하지 않는다.
4. 수정 후에도 줄바꿈이 사라지거나 웹페이지가 입력 내용을 되돌리면, 마스킹이 성공했다고 간주하지 말고 전송하지 않는다. 사용 사이트와 화면 결과를 기록한다.
5. 별도로 프로젝트 루트에서 `node --test browser-extension/detector.test.js`를 실행해 기존 5개 테스트를 확인한다. 이 테스트는 contenteditable DOM 문제를 재현하지는 않는다.
6. 브라우저 확인 후 다음 PDP API 단계로 진행한다.

## 검증 기록

- 팝업 정상 표시, 입력 이벤트 알림, 탐지 알림: 사용자가 확인했다고 보고함.
- 수동 마스킹: 사용자가 가짜 데이터 확인에서 마스킹은 됐으나 줄바꿈이 사라진다고 보고함. 사용자가 마스킹 전에는 줄바꿈이 있고 마스킹 후에 없어진다고 구체적으로 확인함.
- PDP 테스트: 사용자가 로컬에서 7개 테스트 통과를 확인했다고 보고함. 이 작업공간에서는 명령을 실행하지 않았다.
- 탐지기 JavaScript 테스트: 기존 4개 테스트가 통과했고 이전 브라우저 확인도 완료됐다고 사용자가 보고함. 추가한 다섯 번째 문자열 테스트는 이전에 재실행되지 않았고, 이번 contenteditable 수정도 아직 자동·브라우저 검증되지 않았다.
- 줄바꿈 수정: contenteditable 전체 교체를 제거하고 기존 텍스트 노드만 수정하도록 Workbench 파일을 변경했다. 수정 후 Chrome 확인은 대기 중이다.
- 이 작업 공간에서는 Chrome이나 사용자의 로컬 터미널을 직접 실행하지 않았다.

## 누적 기록 2026-10-01 — 계획서 v1.0 및 중간점검 1차

### 계획서 작성
- `docs/plan.md` v1.0 신규 작성. 필수 6항(개요·위협/정책·아키텍처·UX·보안·로드맵/KPI) 포함, 정책 JSON·PDP 입출력·감사로그 JSON 예시 포함.
- 참고안 대비 변경: 무매칭 ALLOW/APPROVAL 분리, RRN 체크섬 가중치화, 로컬1차·하이브리드 추가, 24h 누적카운터, 승인바인딩 강화, 현 구현 한계 명시.
- 현 구현 연결 명시: detector 3종·수동마스킹·PDP데모는 최소구현, 자동차단·서버연동·NER·파일파싱은 로드맵으로 분리.

### 중간점검 1차 제출 항목
- 만든 것: plan v1.0, detector inspect/mask, content.js 관찰+수동마스킹, policy.py 판정, 테스트 5+7개.
- 동작 확인: 이 작업공간 `node --test browser-extension/detector.test.js` → pass 5 fail 0. PDP 7개는 사용자 로컬 보고 통과.
- 확인법: (1) node 테스트 (2) chrome://extensions 가짜4줄 안내확인 (3) plan JSON과 README 범주계약 대조.
- 바뀐 점과 이유: 위 정책 의미론·RRN·원문전송·누적·바인딩 변경, 이유는 오탐/오탈락/우회/재사용 방지.
- AI/본인: AI는 구조화·예시·정규식·수정안·데모·뼈대. 본인은 가짜문구·미전송원칙·한계명시·재확인 분리 결정, 최종책임 본인.
- 다음 할 일: Chrome줄바꿈 재확인, PDP재실행, 원문없는 연동·BLOCK제어·승인연결, 탐지·파일·감사확장.
- URL·저장소: https://github.com/dyj02056/ai-input-protection-gateway, 별도배포없음, 작업공간 c:\Users\User\Documents\ai-input-protection-gateway.
- 검증: detector 5/5 이 작업공간 통과. 브라우저 재확인·PDP재실행은 다음 점검까지 직접 수행 예정.

## 누적 기록 2026-10-01 — Pages 데모 추가

- `docs/index.html` 신규: 1차 홈, 데모·저장소·계획서 링크, 3단계 확인법.
- `docs/demo.html` 신규: detector.js 로컬 데모. 검사→범주ID 표시, 마스킹→미리보기, PDP데모 판정 표시. 서버 전송 없음, 가짜문구 기본값.
- `docs/detector.js` 복사: Pages 경로용 (`./detector.js` 참조로 수정). 원본 `browser-extension/detector.js`와 동일 내용 유지.
- `docs/plan.md` v1.1로 갱신: 배포 URL 섹션 추가, B.6에 Pages URL 기재.
- 검증: `docs/detector.js` vm 로드 → inspect government_id·mask 전화번호 확인 OK. `node --test browser-extension/detector.test.js` pass 5 fail 0.
- 배포 URL: https://dyj02056.github.io/ai-input-protection-gateway/ (Repo Settings → Pages → Deploy from branch → main → /docs 저장 후 유효). 데모 직접경로: .../demo.html.
- 다음: GitHub Pages 설정 후 URL 접속 확인, plan.md 원본 19KB 백업본에서 축소된 내용 복원 여부 결정.



## 누적 기록 2026-10-01 — 중간점검 2차

### 이번에 만든 것 (1차 유지 + 2차 신규, 실제 동작)
- 유지: plan, detector inspect/mask, content.js 안내+수동마스킹, policy.py 범주판정, Pages index/demo.
- 신규: 이메일 범주 추가 (`email` → MASK, 브라우저·PDP·데모 모두 반영, 탐지 3종→4종).
- 신규: NFKC 정규화 후 검사 (전각 숫자·하이픈 변형 탐지, `docs/detector.js` 동기화).
- 신규: 확장 안내문에 PDP 데모 조치 표시 (MASK/BLOCK/APPROVAL 문구, 차단은 하지 않음 명시).
- 신규: Pages demo 가짜 5줄·2차 변경점 섹션, index 2차 문구·확인법 갱신.
- 실제 동작: 이메일+전각 혼합 입력에서 `["phone_number","email"]` 반환·마스킹 확인, node 6/6·PDP 9/9 통과.

### 확인하는 방법 (3단계 이내)
1. 배포 URL demo 접속 → 가짜 5줄 입력 → 범주·마스킹·PDP판정 확인 (실정보·전송 금지).
2. `node --test browser-extension/detector.test.js` → pass 6 확인.
3. `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → 9 tests OK 확인.

### 바뀐 점과 이유
- 1차 동일 부분은 그대로 유지 (plan 구조·3종 탐지·수동마스킹·PDP판정·Pages 기반).
- 이메일 추가: 업무 입력 빈도가 높아 2차 탐지 확대 대상으로 선정.
- NFKC 정규화: 전각 변형 우회 내성 강화, 탐지 우선·마스킹 보조 원칙.
- 조치 안내 표시: BLOCK 오해 방지 (판정 이름만 표시, 전송 미차단 명시).
- 테스트 확대: detector 5→6개·PDP 7→9개 회귀 보장.
- 미구현 유지: 자동 차단·서버 연동·NER·파일파싱은 3차·최종 단계로 이월.

### AI에게 맡긴 일과 내가 판단한 일
- AI가 만든 부분: 이메일 정규식·NFKC 함수·안내문 문구·테스트 2종 추가·데모/index 갱신안·plan v1.2 정리.
- 내가 판단한 일: 가짜문구·미전송 원칙 유지, BLOCK 미동작·서버 미연동 한계 명시, 전각 마스킹은 탐지 우선로 제한, 최종 제출 범위·표현 책임은 본인.

### 다음에 할 일
- 다음 점검까지: 확장↔PDP 원문없는 연동 설계·구현, BLOCK 전송제어·승인 연결, 탐지·파일·감사 확장.
- 최종 제출 뒤: RAG·도구·출력 재검사, SIEM 연동, 업종 정책팩.

### 결과물 URL, 소스 저장소
- 배포: https://dyj02056.github.io/ai-input-protection-gateway/demo.html (홈: https://dyj02056.github.io/ai-input-protection-gateway/)
- 저장소: https://github.com/dyj02056/ai-input-protection-gateway
- 검증: node 6/6·PDP 9/9 이 작업공간 통과, demo vm 로드 확인.


## 누적 기록 2026-10-01 — 최종 제출

### 이번 과정에서 만든 것 (새로 구현하거나 완성한 기능과 실제 동작)
- 유지: 로컬 탐지 4종+NFKC, PDP 데모 판정, 수동 마스킹, 테스트 detector 6개·PDP 9개.
- 신규: Pages 홈 디자인 개편 (히어로·카드·외부 AI 연결 버튼·3단계 확인법).
- 신규: 데모 페이지 개편 (검사·마스킹·복사 버튼, 판정 배지, 외부 AI 버튼, 가짜 5줄 기본값).
- 신규: ChatGPT·Claude·Gemini 연결 버튼 (새 탭 열기만 수행, 자동 입력·전송 없음).
- 신규: `docs/plan.html` 계획서 웹페이지, `docs/plan.md` v2.0 정리 (최종 부록 B + 1·2차 유지).
- 실제 동작: node 6/6·PDP 9/9 통과, 데모에서 이메일+전각 범주·마스킹 확인.

### 확인하는 방법 (3단계 이내)
1. 배포 홈→데모 접속 → 가짜 5줄 입력 → 범주·마스킹·판정 확인, 외부 AI 버튼 새 탭 동작 확인 (실정보·전송 금지).
2. `node --test browser-extension/detector.test.js` → pass 6 확인.
3. `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → 9 tests OK 확인.

### 바뀐 점과 그 이유
- 1·2차 동일 부분은 그대로 유지 (탐지·판정·보안 원칙·미구현 범위).
- 디자인 개편: 기본 형태라는 지적 반영, 최종 제출용 가독·버튼·외부 연결 강화.
- 외부 버튼 추가: 실제 사이트 연결 요구 반영, 이동만 허용해 전송 오해 방지.
- 계획서 웹페이지화: 심사 접근성 향상, md 원문은 저장소에 유지.
- 로직 변경 없음: 탐지·보안·차단 범위는 2차와 동일.

### AI에게 맡긴 일과 내가 판단한 일
- AI가 만든 부분: 홈·데모 디자인안, 외부 버튼·복사 버튼·판정 배지 코드, plan.html·v2.0 정리안.
- 내가 직접 검토·수정한 부분: 외부 버튼은 이동만 허용 결정, 자동 입력·전송 금지 명시, 가짜문구·한계 문구 유지, 최종 범위·표현 책임은 본인.

### 다음에 할 일
- 최종 제출 뒤 보완: 확장↔PDP 원문없는 연동, BLOCK 전송제어·승인 연결, 파일 파싱·감사 해시체인, RAG·도구·출력 재검사, SIEM 연동, 업종 정책팩.
- 다음 점검은 없음 (최종 제출). 위 보완은 제품 고도화 단계에서 진행.

### 결과물 URL, 소스 저장소
- 홈: https://dyj02056.github.io/ai-input-protection-gateway/
- 데모: https://dyj02056.github.io/ai-input-protection-gateway/demo.html
- 계획서: https://dyj02056.github.io/ai-input-protection-gateway/plan.html
- 저장소: https://github.com/dyj02056/ai-input-protection-gateway
- 검증: node 6/6·PDP 9/9 이 작업공간 통과.

## 누적 기록 — 로고 A안 파일 생성

- `browser-extension/icons/logo-a.svg` 신규: 파란 방패 + 흰색 `&gt;_` 커서, 128 viewBox, 투명 배경.
- `docs/logo-preview.html` 신규: 128/48/32/16px 크기별 표시 + 다크 배경 확인용.
- 검증: detector 6/6·PDP 9/9 이 작업공간 통과. 로고 시각 확인은 배포 URL에서 직접 확인 필요.
- 로고 URL: https://dyj02056.github.io/ai-input-protection-gateway/logo-preview.html

## 누적 기록 — 로고 B·C안 추가

- `browser-extension/icons/logo-b.svg` 신규: 파란 둥근 사각 + 흰색 눈 외곽 + 검은 마스킹 바 (마스킹 강조).
- `browser-extension/icons/logo-c.svg` 신규: 검은 둥근 사각 + 파란 게이트 틀 + 흰색/파란 점 3개 (게이트웨이 컨셉).
- `docs/logo-preview.html` 개편: A·B·C안 비교 (128/48/16px + 다크 배경).
- 검증: detector 6/6·PDP 9/9 이 작업공간 통과. 시각 확인은 배포 URL에서 직접 확인 필요.

## 누적 기록 2026-10-01 — 확장 프로그램 v1.0 (스토어 제출)

### 이번 과정에서 만든 것 (새로 구현하거나 완성한 기능과 실제 동작)
- 유지: 로컬 탐지 4종+NFKC, 수동 마스킹, PDP 데모 판정. 탐지 규칙·판정 로직·보안 원칙은 변경 없음.
- 확정: 로고 **A안**(파란 방패 + 흰색 `>_` 커서). `browser-extension/icons/logo.svg`로 복사.
- 신규: 로고 A안 **PNG 아이콘 4종**(16/32/48/128). SVG 래스터라이저가 없어 `tools/make_icons.py`가 방패 폴리곤·베지어 곡선·글리프를 PIL로 직접 그리고 8배 슈퍼샘플링 후 LANCZOS로 축소한다. 16px는 내부 링과 `>_`가 뭉개져 **내부 링을 빼고 `>` 셰브론만 키운 단순화 버전**을 쓴다(육안 비교 후 확정).
- 신규: `manifest.json` v1.0.0 — 아이콘 4종 맵, `options_page`, 백그라운드 서비스 워커, `storage` 권한, Gemini 호스트/스크립트 추가.
- 신규: `background.js` — 설치 시 시작 가이드 1회, 탭 이동 시 배지 초기화, content.js 메시지로 **탭별 판정 배지**(초록/주황/빨강).
- 신규: `popup.html`·`popup.css`·`popup.js` — 현재 탭 지원 여부만 표시(상태 점 포함), 30초 사용법, 바로가기 3개.
- 신규: `options.html`·`options.js` — 탐지 4종 on/off, 마스킹 방식(자리표시자 / 토큰은 다음 버전 비활성), 로컬 기록 삭제.
- 신규: `onboarding.html` — 설치 직후 60초 시작 가이드.
- 신규: `tools/package_store.py` — 제출 ZIP 생성기(개발 파일 제외, manifest 아이콘 존재 검사, ZIP 경로 `/` 구분자 강제).
- 신규: `docs/privacy.html` 개인정보 처리방침, `docs/store-listing.md` 스토어 등재 문안(요약·상세·권한 사유·데이터 사용 신고·스크린샷 계획).
- 신규: `docs/icons/` 사본 + `docs/logo-preview.html` 개편 — 기존 페이지가 배포 환경에서 깨지는 `../browser-extension/` 경로를 가리키던 문제를 함께 고쳤다.
- 수정: `detector.js` — `inspect(text, options)` / `mask(text, options)`에 `{ disabledCategories }` 옵션 인자 추가. **기존 1인자 호출은 그대로 동작**(하위 호환)하며 `docs/detector.js`와 동기화했다.
- 수정: `content.js` — `chrome.storage.local`의 `enabled`를 읽어 **끈 범주를 탐지와 마스킹에서 모두 제외**하고, 설정 변경을 실시간 반영. 판정 이름만 `background.js`에 알린다(원문·범주 ID 미전송).
- 실제 동작 검증: `node --test browser-extension/detector.test.js` → **pass 8 / fail 0**, `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → **9 tests OK**. 제출 ZIP은 15개 파일, 원본 45,558B → ZIP 28,730B, 항목 경로 `/` 구분자, 루트 `manifest.json` 확인(`zipfile.testzip()` → None).

### 확인하는 방법 (3단계 이내)
1. `py tools/package_store.py` → `dist/ai-input-protection-gateway-1.0.0.zip`을 `chrome://extensions`(개발자 모드)에서 "압축해제된 확장 프로그램을 로드"로 설치 → 시작 가이드 확인 → ChatGPT·Claude에 **가짜 5줄** 붙여넣기 → 안내·마스킹·배지 확인 (실정보·전송 금지).
2. `node --test browser-extension/detector.test.js` → pass 8 확인.
3. `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → 9 tests OK 확인.

### 바뀐 점과 그 이유
- 1·2차·최종 제출과 동일한 부분: 탐지 정규식 4종·NFKC, 수동 마스킹 방식, PDP 데모 판정, 원문 미저장·로컬 처리·자동 차단 없음 원칙. **로직은 건드리지 않았다.**
- 아이콘 PNG: 스토어가 128px 아이콘 PNG를 요구하고, manifest가 PNG를 참조하므로 SVG만으로는 심사·설치가 불가능했다.
- 16px 단순화: 16px에서는 내부 링과 `>_`가 뭉개져 형태가 사라졌다. 방패와 `>`만 남겨 툴바에서도 알아볼 수 있게 했다.
- 설정 연동: 설정 화면만 만들고 실제 검사에 반영하지 않으면 사용자에게 거짓 상태를 보여주게 된다. `detector`에 옵션 인자를 추가하되 기존 호출을 깨지 않는 방식으로 붙였다.
- `tabs` 권한 미요청: 팝업에서 탭 주소를 읽지 못하는 대신 "방문 기록 읽기" 경고를 만들지 않았다. 읽을 수 없는 탭은 "지원 사이트가 아님"으로 표시한다.
- 온보딩·문안·처리방침: 심사 요건(단일 목적, 권한 사유, 개인정보 처리방침 URL, 데이터 사용 신고)을 코드와 별개로 충족해야 했다.
- 미구현 유지: 자동 전송 차단, 서버·PDP 실호출, 파일 검사, 승인 워크플로, NER. 문안·README·팝업에 모두 명시했다.

### AI에게 맡긴 일과 내가 판단한 일
- AI가 만든 부분: `tools/make_icons.py`·`tools/package_store.py`, `background/options/onboarding/popup` 코드, `detector` 옵션 인자와 테스트 2개, `privacy.html`·`store-listing.md`·README·계획서 부록 C 초안.
- 내가 판단한 일: 로고 **A안 최종 확정**, 16px 단순화 허용, 자동 차단 없음 원칙 유지, 로고 B·C 시안은 저장소에 기록용으로만 남김, 공개 문구의 과장 금지, 최종 제출 범위·표현의 책임은 본인.

### 남은 일 (제출 직전 사용자 작업)
- 실제 Chrome에서 확장 로드 후 가짜 문구 검증(자동 테스트는 contenteditable DOM을 재현하지 않음).
- 스토어 스크린샷 1장 이상(1280×800 또는 640×400) 캡처 후 등재, 비공개 테스트 → 공개 전환.
- 위 검증 전에는 "동작 확인 완료"로 단정하지 않는다.

### 결과물 URL, 소스 저장소
- 홈: https://dyj02056.github.io/ai-input-protection-gateway/
- 데모: https://dyj02056.github.io/ai-input-protection-gateway/demo.html
- 계획서: https://dyj02056.github.io/ai-input-protection-gateway/plan.html
- 아이콘·브랜드: https://dyj02056.github.io/ai-input-protection-gateway/logo-preview.html
- 개인정보 처리방침: https://dyj02056.github.io/ai-input-protection-gateway/privacy.html
- 저장소: https://github.com/dyj02056/ai-input-protection-gateway
- 검증: detector 8/8·PDP 9/9 이 작업공간 통과, 제출 ZIP 구조 검증 통과.

---

## 마스킹 줄바꿈 결함 수정 (제출 전, 사용자 보고)

### 무엇이 문제였나
- 사용자가 실제 마스킹을 해보고 보고: 여러 줄을 마스킹하면 줄 사이에 **빈 줄이 하나씩 생긴다.**
  ```text
  010-0000-0000        [전화번호]
  000000-1000000  →    (빈 줄)          ← 잘못된 결과
                       [주민등록번호]
  ```

### 원인 (헤드리스 Chrome으로 실측 확인)
- **읽기**: `content.js`의 `readEditorText()`가 `innerText`를 썼다. HTML 명세의 `innerText`는 `<p>` 요소 경계마다
  줄바꿈을 **2개**로 계산한다("If node is a `p` element, then append 2"). ChatGPT·Claude·Gemini가 쓰는
  문단 구조 `<p>a</p><p>b</p>`(실제 2줄)가 `"a\n\nb"`로 읽혔다. 실측: `<p>` 두 줄 → innerText LF=2,
  `<div>`·`<br>` 두 줄 → LF=1. → **`<div>`·`<br>` 편집기에서는 증상이 없었고 문단 편집기에서만 났다.**
- **쓰기**: `writeContentEditableText()`가 편집기 자식을 **전부 지우고** `\n`을 `<br>`로 바꿔 다시 넣었다.
  그래서 읽을 때 생긴 없던 `\n`이 `<br><br>`(진짜 빈 줄)로 굳었다. 부수적으로 `<p>`·`<div>`·서식이 모두 사라졌다.
- 결과: 5줄 예시가 마스킹 후 **9줄**이 되었다.

### 어떻게 고쳤나
- 읽기: `innerText` → **자체 구조 순회**(`readContentEditable`). 블록 경계와 `<br>`을 각각 줄바꿈 1개로 세고,
  `<p><br></p>` 같은 빈 문단은 빈 줄로 남긴다. `display:none`·`script`·`style`은 제외한다.
- 쓰기: 전체 재작성 → **위치 기반 치환**(`replaceInTextNodes`). 일치한 구간이 걸친 텍스트 노드의 문자만 바꾸므로
  문단·`<br>`·서식이 그대로 남고, 마스킹이 줄 수를 바꿀 수 없다. 적용 후 다시 읽어 예상 결과와 다르면
  **전부 되돌리고 중단**한다(문안에 약속한 동작).
- API: `detector.findMatches(text, options)`(범주 ID·위치만 반환, 원문 미포함)와
  `applyMatches(text, matches)`를 **추가**. `mask()`·`inspect()`는 그대로 두어 하위 호환과 데모 페이지 동작을 유지했다.
  알림의 `canMask` 판정도 새 API를 함께 확인하도록 고쳤다.
- 달라진 동작: 전각 숫자처럼 원문 표기가 다른 값만 있으면 전체를 정규화해 덮어쓰지 않고 **입력란을 바꾸지 않은 채**
  안내만 표시한다. 구조를 지키는 쪽을 택한 결과이며, README·`plan.md` 부록 D에 명시했다.

### 검증
- 신규 `tools/dom_test.py` + `tools/dom_test.html`: 로컬 Chrome을 헤드리스로 띄워 **확장 코드를 그대로 실행**하고
  알림 창의 마스킹 버튼까지 실제로 눌러, 결과 DOM 구조와 화면에 그려진 줄 수(문자 rect의 top 개수)를 비교한다.
  `<p>`·`<div>`·`<br>` 세 구조, 5줄 예시, 빈 줄 유지, 한 줄에 값 2개, 값이 여러 인라인 요소에 나뉜 경우까지 **16/16 통과**.
- **수정 전 코드로 같은 테스트를 돌려 실패를 재현**했다: `<p>` 두 줄 → `<p>[전화번호]</p><p>[주민등록번호]</p>` 대신
  `[전화번호]<br><br>[주민등록번호]`(3줄, 실패 10건), 5줄 → 9줄. 즉 테스트가 실제로 이 버그를 잡는다.
- `node --test browser-extension/detector.test.js` → **14/14**(신규 6개: 위치 정확성, 원문 미포함, 옵션 반영,
  `applyMatches(findMatches(x)) == mask(x)` 일치, 전각 변형 구분, 인수 누락 방어).
- `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → **9 tests OK**. 기존 검증 스크립트도 전 항목 통과.
- 제출 ZIP 재생성: 15개 파일, 원본 54,549B → ZIP 31,532B, `/` 구분자, 루트 `manifest.json`, `testzip()` None.
- 문서 동기화: `browser-extension/README.md`(원인·수정·테스트 절차), `docs/plan.md`·`plan.html`(부록 D),
  `docs/store-listing.md`(심사 확인 절차·체크리스트), `docs/index.html`(패키지 크기), `docs/detector.js`.

### 판단한 일
- **버전은 1.0.0 유지**(아직 스토어 제출 전이고, 심사 전 결함 수정이므로 별도 버전을 만들지 않았다).
- 자동 차단·서버 연동 등 미구현 범위는 건드리지 않았다. 탐지 규칙·판정 로직·로컬 처리 원칙도 그대로다.
- 편집기 DOM을 직접 바꾸는 방식의 위험(사이트 내부 상태·커서 보존 미보장)은 여전하며 README에 명시했다.

### 남은 일 (사용자)
- 실제 Chrome에서 위 두 줄·5줄 예시를 마스킹해 **빈 줄이 생기지 않는지** 육안 확인.
- 스토어 스크린샷 캡처 후 비공개 테스트 → 공개 전환.



## 누적 기록 2026-10-01 — 확장 v1.1.0 (지속 감지 안내 + 선택형 강제 기능)

### 요청
- (1) 감지 안내가 8초 뒤 사라지지 않게 계속 떠 있게 해 달라.
- (2) 이전에 약속만 하고 없던 기능(실행 취소, 감사 기록, 브라우저 내 정책 엔진, 전송 차단)을 켜고 끌 수 있게 해 달라.

### 무엇을 만들었나
- `browser-extension/policy.js` 신규. `gateway-core/pdp/policy.py`와 같은 우선순위·기본 매핑·미등록 범주 처리를 브라우저 안에서 계산한다. 범주 ID 배열만 받고 원문 문자열은 `TypeError`로 거절한다. `tools/policy_cases.json`(12 케이스)을 양쪽이 공유하고 `tools/policy_parity.py`가 대조한다.
- `content.js`: `DEFAULT_FEATURES`와 `coerceFeatures()` 도입, `storage.onChanged`로 `enabled`/`features` 반영, `applySettings()`로 한 곳에 모음.
- 안내 창을 `alert`/`result`/`info` 세 종류로 나눴다. `alert`만 지속 표시되고(기본), `result`·`info`는 8초. `×` 닫기 버튼과 `실행 취소` 버튼 추가. 안내 위치는 `data-position` CSS로 전환.
- 실행 취소: 마스킹 시 이전 상태를 최소 정보로 저장(`plain` / `nodes`)해 한 번 되돌린다.
- 감사 기록: 판정 이름·범주 ID·시각만 `chrome.storage.local.history` 최근 20건. 동일 판정 반복은 1건으로 접는다. 원문·위치 미저장.
- 전송 차단: Enter / `submit` / 전송 버튼 클릭 캡처 리스너. 첫 시도만 막고 5초 내 재시도는 허용.
- 설정 화면: 기능 스위치 7개 + 안내 위치 라디오 + 감사 기록 표(최근 20건, 전체 삭제). 기존 1.0.0 사용자에게 `features`가 없으므로 기본값으로 채운다.

### 기본값 원칙
- **표시 방식**(지속 안내·자동 닫기·실행 취소·위치)만 켜짐.
- **강제 기능**(정책 적용·전송 차단·승인 확인·감사 기록)은 전부 꺼짐. "기본으로는 자동으로 막지 않는다"는 원칙 유지.

### 구현 중 잡은 실제 결함 2건
1. **클릭 1회가 click과 submit 두 경로를 탄다** → 재시도 허용 직후 `submit`이 다시 막혀 "5초 내 재시도 허용"이 성립하지 않았다. 허용한 입력 묶음의 제출만 통과시키는 `allowPendingSubmit`을 추가했다. 하네스를 추가한 뒤 처음 드러난 문제다.
2. **`requireConfirm`이 `blockSend`에 종속** → 승인 확인만 켜도 동작하지 않았다. 두 스위치를 독립 게이트로 분리했다.

### 검증
- `node --test browser-extension/detector.test.js browser-extension/policy.test.js` → **24/24**.
- `py tools/dom_test.py` → **44/44** (기존 16 + 신규 28). 가상 시간으로 20초 지속과 8초 자동 닫힘을 확인.
- `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → **9/9**.
- `py tools/policy_parity.py` → **12/12**.
- `py tools/package_store.py` → `dist/ai-input-protection-gateway-1.1.0.zip`, 16개 파일, 원본 88,207B → 41,122B, `testzip()` None.
- `node --check`로 `content.js`·`options.js`·`policy.js` 문법 확인.

### 남은 위험·다음 단계
- `policy.js`는 조직 PDP 서버 정책과 같지 않다. 실제 API 연동은 아직 없다.
- 전송 차단은 확실한 차단이 아니다(첫 시도만 막고 5초 내 재시도로 통과).
- 세션 토큰 마스킹은 다음 버전. 되돌리기는 직전 1회 실행 취소뿐.
- `contenteditable` DOM 직접 수정 위험은 그대로다.
- 스토어 스크린샷 캡처 후 비공개 테스트 → 공개 전환.
