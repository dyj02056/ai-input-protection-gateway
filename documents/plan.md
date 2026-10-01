# 중소기업용 생성형 AI 입력정보 보호 게이트웨이 제작 계획서

> 문서 버전: v2.1 (최종 제출 + 확장 v1.0) / 작성일: 2026-10-01
> 배포: https://dyj02056.github.io/ai-input-protection-gateway/
> 구현: `browser-extension/`, `gateway-core/pdp/`, `submission_note.md`

## 0. 요약

| 항목 | 내용 |
|---|---|
| 제품 정의 | 외부 AI 입력·첨부·전송을 전송 직전에 검사하고 ALLOW/MASK/APPROVAL/BLOCK을 강제하며 원문 없이 감사하는 게이트웨이 |
| 목표 고객 | 50~500명 중소기업 (B2B SaaS·커머스·고객센터·개발) |
| 도입 형태 | 1) 브라우저 확장 2) API 프록시 |
| 현 구현 | 로컬 탐지 4종+NFKC+수동마스킹+실행 취소, 브라우저 내 로컬 정책 엔진(`policy.js`, 기본 꺼짐), 지속 감지 안내, 선택형 감사 기록·전송 차단. 서버 연동·토큰 마스킹 미구현 |
| 배포 | Pages 홈·데모·계획서 (`index/demo/plan.html`). 서버 전송 없음 |
| 목표·일정 | p95 300ms, 재현율 95%+, 오탐 5% 이하. P1 0~8주 / P2 2~4개월 / P3 4~8개월 |

원칙: 흐름 통제, 원문 미저장·로컬 1차 탐지, 마스킹·승인 안전 통과 경로.

## 1. 개요 및 배경

문제: 무통제 붙여넣기, 정규식 한계·경고피로, 일괄차단 역효과, RAG·도구·출력 신경로, 인력 0~2명 현실.
속성: 유형·민감도·건수·누적, 역할·부서, 목적, 대상·계정·지역·학습사용, 등급·채널.
고객: 결정자·운영(CPO)·승인자·사용자. ICP 100~300명·개인정보 대량·ISMS-P.
가치: 1일 적용·정책팩, 4단계 강제, 마스킹후 복원, 원문없는 재현, 원문미저장·하이브리드.
MVP: 확장 MV3, OpenAI/Anthropic 프록시, 주민·전화·이메일·키, 파일 PDF/DOCX/XLSX/HWPX(구HWP 텍스트, OCR 5p). 제외: 모바일·데스크톱앱, 웹출력재검사, RAG·SIEM, 100% 보장. 현구현 4종+수동마스킹.

## 2. 위협 모델 및 제어 정책

자산: 개인정보·기밀·코드자격증명. 행위자: 부주의(최우선), 우회·간접공격(높음), 악의(감사억지).
경로: 프롬프트·분할누적(24h)·인코딩(정규화)·파일(OCR)·코드(지문)·RAG(ACL)·도구(허용목록)·출력(버퍼)·로그(미저장)·인젝션(경계분리)·우회(강제설치)·자체(메모리분리).
조치: ALLOW, MASK(토큰·복원), APPROVAL(1회전송), BLOCK(미전송·대안). 전체평가후 최제한, priority 정렬용, exception만 완화(non_overridable 불가), 무매칭 0건 ALLOW/있음 APPROVAL, 변환후 재판정.
데모: 0건 ALLOW, 주민/전화/이메일 MASK, 키 BLOCK, 미등록 APPROVAL, 혼합 최엄격.

정책 JSON: `{"policy_id":"external_ai_input","version":3,"fallback":{"no_detection":"ALLOW","with_detection":"REQUIRE_APPROVAL"},"rules":[{"id":"block_prohibited_identifiers","priority":1000,"non_overridable":true,"action":"BLOCK"},{"id":"block_bulk_customer_data","priority":900,"action":"BLOCK"},{"id":"approve_confidential_document","priority":800,"action":"REQUIRE_APPROVAL"},{"id":"mask_low_volume_contact_data","priority":700,"action":"MASK"}]}`

PDP 입출력(원문 미수신): 요청 `{"detected_categories":["government_id"]}` → 결과 `{"action":"MASK","restore_on_response":true}`. 정식 스키마로 확장 예정.

## 3. 아키텍처 및 핵심 기능

확장PEP(가로채기·detector.js)→검사API→PDP→Transformer→Vault(TTL)+승인+감사(해시체인)+파일Worker(격리). 프록시 요청·SSE·tool_use 검사. SaaS/하이브리드/로컬우선. 현구현 관찰+수동마스킹.
탐지: NFKC→정규식→체크섬(RRN 가중치만)→NER→문맥→구조→PDP속성. detector 4종+NFKC.
파일: PDF·DOCX·XLSX열판정·HWPX·구HWP텍스트·ZIP1단계·암호화 APPROVAL/BLOCK, 30초 즉시삭제.
기술: MV3, Go, Go+Python, OPA/Rego, ONNX CPU, PG+Vault분리, OIDC/SCIM, KMS, OTel 원문차단.

## 4. UX 및 워크플로우

작성→배지→ ALLOW 즉시 / MASK 미리보기후 1클릭 / APPROVAL 사유→대기→알림 / BLOCK 사유+대안 → 응답복원. 본인 로컬하이라이트, 승인자 원문비노출. content.js는 조치안내+수동마스킹.
승인: HMAC바인딩 일회성·재승인·자기승인금지·SLA 4h·1h에스컬레이션·재판정.
콘솔: 온보딩·대시보드·문장형정책·시뮬·승인함·로그·레지스트리·ISMS-P보고서. 관찰→안내→강제.

## 5. 보안 및 데이터 보호

원문미저장, 파일즉시삭제(격리24h), Vault TTL2h, 감사1년, 포렌식30일·이중승인, 로그30일 원문차단. inspect 범주ID만 반환. 현 mask 자리표시자.
감사: `{"action":"MASK","policy_version":"external_ai_input@3","payload_stored":false}` + 해시체인·가명ID.
규제: RRN BLOCK, 지역라우팅, ISMS-P증적.

## 6. 로드맵 및 KPI

P1 0~8주(2파일럿), P2 2~4개월(유료5사), P3 4~8개월(20사). 예산 p95 300ms=20+60+20+120+10+30+40.
KPI: 지연300→200ms, 재현율95→97, 정밀90→95, 오탐5→3%, 우회80→90%, 설치90→98%.
## 부록 B. 최종 제출 (2차 유지 + 최종 변경분)

B.1 이번 과정에서 만든 것: Pages 홈·데모 디자인 개편(히어로·카드·KPI), ChatGPT·Claude·Gemini 외부 연결 버튼(새 탭 열기만, 전송 없음), 데모 복사 버튼·판정 배지, `plan.html` 계획서 웹페이지 신규, plan v2.0 정리. 기존 탐지·판정 로직은 유지하며 node 6/6·PDP 9/9 통과.
B.2 확인 방법: (1) 배포 홈→데모 가짜5줄→외부 AI 버튼 동작 확인 (2) node pass 6 (3) PDP 9 tests OK.
B.3 바뀐 점과 이유: 기본 디자인을 최종 제출용으로 정리(가독·버튼·외부 연결), 계획서도 웹페이지로 제공(심사 접근성). 탐지·보안 원칙·미구현 범위는 변경 없음.
B.4 AI/본인: AI는 디자인·버튼·plan.html·문구안 작성. 본인은 외부 버튼은 이동만 허용(자동입력·전송 금지), 가짜문구·한계명시 유지 결정. 최종책임 본인.
B.5 다음에 할 일: 최종 제출 뒤 확장↔PDP 연동, BLOCK 전송제어·승인 연결, 파일·감사·RAG·SIEM·업종팩.
B.6 URL: 홈 https://dyj02056.github.io/ai-input-protection-gateway/ · 데모 .../demo.html · 계획서 .../plan.html, 저장소 https://github.com/dyj02056/ai-input-protection-gateway.

### 부록 B-1. 중간점검 2차 (유지)

2차 신규: 이메일 3종→4종, NFKC, 조치안내, 테스트 6+9개. 확인법: demo 5줄·node 6·PDP 9. URL 동일.

### 부록 B-2. 중간점검 1차 (유지)

1차: plan v1.0, Pages index/demo, detector·PDP 데모, 테스트 5+7개. URL 동일.

MVP완료: 양경로제어·E2E·재현·무저장검증·degraded기록·리포트·단독온보딩.

## 부록 C. 확장 프로그램 v1.0 (최종 제출, 2026-10-01)

C.1 이번 과정에서 만든 것: Chrome MV3 확장을 스토어 제출 품질로 완성.
`manifest.json` v1.0.0(아이콘 4종 맵·`options_page`·`background` SW·`storage` 권한·Gemini 호스트/스크립트 추가),
`background.js`(설치 시 시작 가이드 1회, 탭별 판정 배지), `popup.html/css/js`(현재 탭 상태·30초 사용법·바로가기),
`options.html/js`(탐지 4종 on/off, 로컬 기록 삭제), `onboarding.html`(60초 시작 가이드),
로고 A안 아이콘 PNG 16/32/48/128 생성(`tools/make_icons.py`), 제출 ZIP 생성기(`tools/package_store.py`),
개인정보 처리방침(`docs/privacy.html`), 스토어 등재 문안(`documents/store-listing.md`).

C.2 실제 동작(이 작업공간에서 확인):
- 설정에서 끈 범주는 탐지·마스킹에서 모두 제외된다. `detector.inspect(text, {disabledCategories})`,
  `detector.mask(text, {disabledCategories})` 옵션 인자를 추가했고 기존 1인자 호출은 그대로 동작한다(하위 호환).
- 팝업·설정·온보딩 페이지는 정적 파일이며 `chrome.storage.local`만 사용한다. 네트워크 요청 없음.
- 배지 색: 감지 없음(초록 `#0e9f6e`, 문자 없음) / 마스킹·승인 필요(주황 `#b77900`, `!`) / 차단 권고(빨강 `#d92d20`, `!`).
- 제출 ZIP `dist/ai-input-protection-gateway-1.0.0.zip`: 15개 파일, 원본 54,549B → ZIP 31,532B, 항목 경로 `/` 구분자, 루트에 `manifest.json`.

C.3 확인 방법: (1) `dist/ai-input-protection-gateway-1.0.0.zip`을 `chrome://extensions`에 로드 → 가짜 5줄 붙여넣기 → 안내·마스킹 확인 (2) `node --test browser-extension/detector.test.js` → pass 14 (3) `py tools/dom_test.py` → 16/16 (4) `py -m unittest discover -s gateway-core/pdp -p "test_*.py"` → 9 tests OK.

C.4 바뀐 점과 이유: 2차·최종 제출의 탐지 규칙·판정 로직·보안 원칙(원문 미저장·로컬 처리·자동 차단 없음)은 변경하지 않았다.
스토어 심사 요건(128px 아이콘, 개인정보 처리방침 URL, 권한 사유, 단일 목적)을 충족하기 위해 아이콘·설정·온보딩·문안을 추가했다.
`tabs` 권한은 의도적으로 요청하지 않았고, 원격 코드도 사용하지 않는다.

C.5 알려진 한계(문안에 명시): 자동 전송 차단 없음, 서버/PDP 실호출 없음, 파일 검사·승인 워크플로·NER 없음,
`BLOCK`은 안내 이름일 뿐 전송을 막지 않음, 마스킹은 복원 불가 자리표시자 대체.
전각 숫자처럼 원문 표기가 다른 값만 있는 입력은 원문에서 위치를 특정할 수 없어 입력란을 바꾸지 않고 안내만 표시한다.

C.6 AI/본인: AI는 아이콘 생성 스크립트·설정 연동·팝업/온보딩 HTML·문안 초안을 작성했다.
본인은 로고 A안을 최종 확정하고, 자동 차단 없음 원칙 유지와 공개 문구 과장 금지, 최종 제출 범위·표현의 책임을 결정했다.

C.7 다음에 할 일: 스토어 스크린샷 캡처 후 등재 → 확장↔PDP 원문 없는 연동 → BLOCK 전송 제어·승인 연결 → 파일·감사·RAG·SIEM·업종팩.

C.8 URL: 홈 https://dyj02056.github.io/ai-input-protection-gateway/ · 데모 /demo.html · 계획서 /plan.html ·
아이콘 /logo-preview.html · 개인정보 /privacy.html, 저장소 https://github.com/dyj02056/ai-input-protection-gateway.

## 부록 D. 마스킹 줄바꿈 결함 수정 (제출 전)

D.1 증상: 여러 줄을 마스킹하면 줄 사이에 빈 줄이 생겼다. ChatGPT·Claude·Gemini 편집기에서 5줄이 9줄로 늘었다.

D.2 원인: 읽기와 쓰기의 불일치. 읽기는 `innerText`를 썼는데, HTML 명세의 `innerText`는 `<p>` 경계마다 줄바꿈을 2개로 계산한다.
그래서 문단 구조 `<p>a</p><p>b</p>`(실제 2줄)가 `"a\n\nb"`로 읽혔고, 쓰기는 편집기 자식을 전부 지우고 `\n`을 `<br>`로 바꿔 넣어
없던 `\n`이 `<br><br>`(진짜 빈 줄)로 굳었다. `<div>`·`<br>` 구조는 줄바꿈 1개라 증상이 없었다.
헤드리스 Chrome 실측: `<p>` 두 줄 → innerText LF=2, `<div>`·`<br>` 두 줄 → LF=1.

D.3 수정: (1) 읽기를 자체 구조 순회로 교체 — 블록 경계와 `<br>`을 각각 줄바꿈 1개로 센다. (2) 쓰기를 위치 기반 치환으로 교체 —
`detector.findMatches()`가 준 구간의 문자만 바꾸고 문단·`<br>`·서식을 그대로 둔다. `applyMatches()`를 추가했고
`mask()`는 그대로 두어 하위 호환과 데모 페이지 동작을 유지한다. 변경 전에는 알림의 `canMask`가 `mask`만 확인했다.

D.4 검증: `py tools/dom_test.py` — 헤드리스 Chrome에서 확장 코드를 그대로 실행하고 알림의 마스킹 버튼까지 눌러
DOM 구조와 화면에 그려진 줄 수를 비교한다(16/16). 수정 전 코드로 같은 테스트를 돌려 `<p>` 두 줄이 3줄이 되는 것을 확인했다.
`node --test browser-extension/detector.test.js` 14/14, PDP 9/9.

D.5 남은 위험: 편집기 DOM을 직접 바꾸는 방식은 사이트 내부 상태·커서 보존을 보장하지 않는다. 문안과 README에 계속 명시한다.
## 부록 E. v1.1.0 — 지속 감지 안내와 선택형 강제 기능 (2026-10-01)

### E.1 무엇을 Why 했나
- **문제**: 1.0.0의 감지 안내는 8초 뒤 자동 닫힘이었다. 사용자가 입력을 이어 가리는 동안(특히 큰 문장 붙여넣기) 안내가 사라져, 이후에 마스킹할지 판단할 정보를 잃었다.
- **또 다른 문제**: 정책의 `BLOCK`·`REQUIRE_APPROVAL`이 브라우저에서 아무 Enforcement 없이 이름 표시에 머물렀다. 약속한 강제 단계가 없었다.
- **결정**: 화면 표시 방식과 Enforcement를 분리했다. 표시(지속 안내·실행 취소·위치·자동 닫기)는 기본 켜짐, Enforcement(정책 적용·전송 차단·승인 확인·감사 기록)는 **기본 꺼짐**으로 두고 `chrome.storage.local.features` 한 곳에 모아 스위치로 노출했다. "기본으로는 자동으로 막지 않는다"는 원칙은 그대로 지킨다.

### E.2 아키텍처: 브라우저 안 정책 엔진
- `browser-extension/policy.js` 추가. `gateway-core/pdp/policy.py`와 같은 우선순위(`BLOCK` > `REQUIRE_APPROVAL` > `MASK` > `ALLOW`)·같은 기본 매핑·미등록 범주 → `REQUIRE_APPROVAL` + `UNKNOWN_CATEGORY_PRESENT`를 구현한다.
- **원문 문자열은 정책에 넘기지 않는다.** 범주 ID 배열만 받으며 문자열을 넘기면 `TypeError`로 거절한다. 양쪽에서 같은 계약이라 회귀가 생기면 즉시 드러난다.
- `tools/policy_cases.json`을 양쪽이 공유하고 `tools/policy_parity.py`가 `policy.py`와 `policy.js`를 같은 케이스(12개)로 대조한다. **12/12 일치.** 어느 한쪽만 고쳐도 실패한다.
- `content.js`는 `policy.js`를 쓰고, 파일을 못 읽는 경우에만 같은 규칙의 인라인 폴백을 탄다.

### E.3 Enforcement 상세
- **지속 감지 안내**: `alert` 종류 안내는 시간 경과로 닫히지 않는다. 우측 상단 `×`로 닫으면 같은 감지가 이어지는 동안 다시 띄우지 않고, 감지가 사라지면 초기화되어 같은 값이 다시 들어오면 다시 안내한다(닫기 자체가 무의미해지지 않게 하기 위한 설계).
- **실행 취소**: 마스킹 시 이전 상태를 최소 정보로만 저장해(`plain`=값 1개 / `nodes`=변경한 텍스트 노드 목록) 한 번 되돌린다. 무한 히스토리는 두지 않는다.
- **감사 기록**: 판정 이름·범주 ID·시각만 `chrome.storage.local.history`에 최근 20건. 동일 판정이 반복되면(숫자를 한 자씩 입력하는 경우) 마지막 기록과 비교해 1건만 남긴다. **원문·위치 정보 미저장.**
- **전송 차단**: Enter / 폼 `submit` / 전송으로 보이는 버튼 클릭의 캡처 리스너 3종. 첫 시도만 막고 5초 창 안에 재시도하면 허용한다.

### E.4 구현 중 잡은 실제 결함 2건
1. **클릭 1회가 click과 submit 두 경로를 탄다.** 재시도 허용 직후 이어지는 `submit`이 다시 막혀 "5초 안에 다시 누르면 전송"이 실제로 성립하지 않았다. `allowPendingSubmit` 플래그를 두고 같은 입력 묶음에 속한 제출만 통과시킨 뒤 `setTimeout(0)`으로 소멸시킨다. **이 결함은 하네스를 추가한 뒤 처음 드러났다.**
2. **`requireConfirm`이 `blockSend`에 종속돼 있었다.** 게이팅이 `enforcePolicy && blockSend`로 묶여 있어, 승인 확인만 켜도 동작하지 않았다. 두 스위치를 독립 게이트로 분리했다.

### E.5 검증
- `node --test browser-extension/detector.test.js browser-extension/policy.test.js` → **24/24** (detector 14 + policy 10).
- `py tools/dom_test.py` → **44/44**. 저장소 스텁을 실제로 구현해(`get`/`set`/`remove`/`onChanged`) `onChanged` 반영까지 확인하고, 가상 시간(`--virtual-time-budget=90000`)으로 20초 지속과 8초 자동 닫힘을 검증한다. 신규 28개: 기본값 미차단 → 정책+차단 ON 시 차단 → 5초 내 재시도 통과 → 허용 창 만료 후 재차단 → Enter 경로 → 비전송 버튼 통과 → 스위치 독립성 → 감사 기록 원문 없음 → 지속 안내 → 닫기 → 실행 취소 → 위치 → 시간제한 해제.
- `py -m unittest discover -s gateway-core/pdp` → **9/9**. `py tools/policy_parity.py` → **12/12**.
- 제출 ZIP `dist/ai-input-protection-gateway-1.1.0.zip`: 16개 파일, 원본 88,207B → ZIP 41,122B, `/` 구분자, 루트 `manifest.json`, `testzip()` None. 테스트 파일·README 제외 확인.

### E.6 남은 위험
- `policy.js`는 조직 PDP 서버 정책과 **같지 않다.** 브라우저 로컬 판정이므로 실제PDP 연동 전까지 확인 수단으로만 본다.
- 전송 차단은 "확실한 차단"이 아니다. 첫 시도만 막고 5초 내 재시도로 통과한다.
- 세션 토큰 마스킹은 다음 버전이다. 되돌리기는 직전 1회의 실행 취소뿐이다.
- `contenteditable` DOM 직접 수정 위험은 E 부록 D와 동일하게 남는다.
