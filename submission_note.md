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

