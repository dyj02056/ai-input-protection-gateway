# 중소기업용 생성형 AI 입력정보 보호 게이트웨이 제작 계획서

> 문서 버전: v2.0 (최종 제출) / 작성일: 2026-10-01
> 배포: https://dyj02056.github.io/ai-input-protection-gateway/
> 구현: `browser-extension/`, `gateway-core/pdp/`, `submission_note.md`

## 0. 요약

| 항목 | 내용 |
|---|---|
| 제품 정의 | 외부 AI 입력·첨부·전송을 전송 직전에 검사하고 ALLOW/MASK/APPROVAL/BLOCK을 강제하며 원문 없이 감사하는 게이트웨이 |
| 목표 고객 | 50~500명 중소기업 (B2B SaaS·커머스·고객센터·개발) |
| 도입 형태 | 1) 브라우저 확장 2) API 프록시 |
| 현 구현 | 로컬 탐지 4종+NFKC+PDP안내+수동마스킹, PDP 데모 판정. 자동 차단·서버 연동 미구현 |
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
