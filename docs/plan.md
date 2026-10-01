# 중소기업용 생성형 AI 입력정보 보호 게이트웨이 제작 계획서

> 문서 버전: v1.0 (중간점검 1차 제출용) / 작성일: 2026-10-01
> 관점: B2B SaaS·생성형 AI 보안 수석 기획자/아키텍트
> 관련 구현: `browser-extension/`, `gateway-core/pdp/`, `submission_note.md`

## 0. 요약

| 항목 | 내용 |
|---|---|
| 제품 정의 | 외부 생성형 AI 입력·첨부·전송을 전송 직전에 검사하고 `ALLOW/MASK/REQUIRE_APPROVAL/BLOCK`을 강제하며 원문 없이 감사 기록을 남기는 게이트웨이 |
| 목표 고객 | 50~500명 중소기업 (우선 B2B SaaS, 커머스, 고객센터, 개발 조직) |
| 도입 형태 | 1) 브라우저 확장 2) API 프록시 — 하나의 PDP·감사체계 공유 |
| 현 구현 | 확장 로컬 탐지 3종+수동 마스킹, PDP 데모 판정, 원문 미반환 계약. 자동 차단·승인·서버 연동 미구현 |
| 목표 | 텍스트 판정 p95 < 300ms, 고위험 재현율 95%+, 오탐률 5% 이하 |
| 일정 | Phase 1 MVP 0~8주 / Phase 2 2~4개월 / Phase 3 4~8개월 |

원칙: (1) 게이트웨이가 흐름 통제 (2) 원문 미저장·로컬 1차 탐지·매핑 분리 (3) 마스킹·승인 안전 통과 경로 제공.

## 1. 프로젝트 개요 및 배경

### 1.1 문제 정의

| 문제 | 현상 | 한계 |
|---|---|---|
| 무통제 입력 | 고객정보·계약서·급여·코드·키 붙여넣기/업로드 | 규정·교육만으로 실시간 통제 불가 |
| 단순 탐지 한계 | 이름·주소·표·스캔·분할 입력 놓침 | 오탐→경고피로→무시·우회 |
| 일괄 차단 역효과 | 업무 불가 | 개인계정·모바일·비관리 브라우저 이동 |
| 에이전트·RAG 확산 | 검색·도구·출력이 새 유출 경로 | 입력창 검사로 커버 불가 |
| 중소기업 현실 | 보안인력 0~2명, DLP/CASB 부담 과다 | 30분 설치·기본 정책팩 제품 부재 |

판정 속성: 유형·민감도·건수·누적량, 역할·부서, 목적, 대상 서비스·계정·지역·학습사용, 문서등급·채널.
### 1.2 목표 고객 및 이해관계자

| 구분 | 대상 | 니즈 |
|---|---|---|
| 구매 결정자 | 대표·CTO·운영 책임자 | 생산성 유지+사고 리스크 제거 |
| 도입·운영 | IT·보안·CPO | 쉬운 배포, 낮은 운영부담, 감사자료 |
| 승인자 | 팀장·CPO·오너 | 빠른 근거 기반 승인 |
| 최종 사용자 | 상담·영업·운영·인사·개발 | 흐름 끊지 않는 안내·대안 |

ICP: 100~300명, 개인정보 대량보유, ChatGPT/Claude 사용 확인, ISMS-P 보유/준비.

### 1.3 핵심가치

도입용이성(1일 전사 적용·정책팩), 실제집행(4단계 강제), 업무연속성(마스킹 후 응답복원), 감사가능성(원문 없이 재현), 프라이버시(원문미저장·하이브리드).

### 1.4 범위

MVP 포함: 확장(Chrome·Edge MV3), API 프록시(OpenAI/Anthropic 호환), 우선탐지(주민·외국인·여권·면허·전화·이메일·카드·계좌·이름·주소·키·고객표), 4단계+승인+감사+콘솔, 파일(PDF/DOCX/XLSX/HWPX, 구HWP 텍스트한정, OCR 5p이하).
MVP 제외: 모바일·데스크톱앱 통제, 웹UI 출력재검사, RAG·SIEM양방향·업종팩, 100% 정확도 보장.
현구현 대응: 3종 탐지+수동마스킹까지만 구현, 자동제어·파일·서버연동은 계획 단계.

## 2. 위협 모델 및 제어 정책

### 2.1 자산·행위자

자산: 개인정보(고유식별·연락·금융·건강인사급여), 기밀(계약·가격·재무·전략), 코드·자격증명(키·DB접속·개인키).
행위자: 부주의 내부자(최우선), 우회 내부자(높음), 간접 외부공격자(높음), 악의 내부자(감사억지).

### 2.2 유출경로와 통제

| 경로 | 통제 | PEP | 단계 |
|---|---|---|---|
| 프롬프트 | 전송전 탐지·마스킹/차단 | 확장·프록시 | P1 |
| 분할누적 | 24h 누적카운터 | 확장·프록시 | P1 |
### 2.4 정책 규칙 예시 (내부 DSL, JSON)

```json
{
  "policy_id": "external_ai_input",
  "version": 3,
  "tenant_id": "tenant-a",
  "fallback": {"no_detection": "ALLOW", "with_detection": "REQUIRE_APPROVAL"},
  "rules": [
    {"id": "block_prohibited_identifiers", "priority": 1000, "non_overridable": true,
     "when": {"destination.type": "external_llm", "detections.type_any": ["resident_id", "foreigner_id", "passport_id", "driver_license", "full_card_number", "secret_key"]},
     "action": "BLOCK", "reason_code": "PROHIBITED_SENSITIVE_DATA",
     "user_guidance": "주민등록번호·카드번호·비밀키 등은 외부 AI로 보낼 수 없습니다."},
    {"id": "block_bulk_customer_data", "priority": 900,
     "when": {"destination.type": "external_llm", "detections.type_any": ["customer_record"], "content.record_count_gte": 100},
     "also_when_cumulative": {"window": "24h", "scope": "user+destination", "record_count_gte": 100},
     "action": "BLOCK", "reason_code": "BULK_CUSTOMER_DATA"},
    {"id": "approve_unapproved_destination_with_pii", "priority": 850,
     "when": {"destination.approved": false, "detections.count_gte": 1},
     "action": "REQUIRE_APPROVAL", "reason_code": "UNAPPROVED_DESTINATION"},
    {"id": "approve_confidential_document", "priority": 800,
     "when": {"destination.type": "external_llm", "content.classification_any": ["confidential", "restricted"]},
     "action": "REQUIRE_APPROVAL", "reason_code": "CONFIDENTIAL_DOCUMENT",
     "approver_roles": ["privacy_officer", "project_owner"]},
    {"id": "mask_low_volume_contact_data", "priority": 700,
     "when": {"destination.approved": true, "detections.type_subset_of": ["person_name", "phone", "email", "address", "order_id"], "content.record_count_lte": 10},
     "action": "MASK", "mask_types": ["person_name", "phone", "email", "address"],
     "reason_code": "LOW_VOLUME_CUSTOMER_DATA"}
  ],
  "exceptions": [
    {"id": "exc-dev-internal-model", "applies_to": {"group": "dev", "destination.model_id": "internal-llm-01"},
     "relax_rule": "approve_confidential_document", "to_action": "ALLOW",
     "expires_at": "2026-12-31T23:59:59+09:00", "created_by": "admin-02",
     "justification": "사내 호스팅 모델, 외부 전송 없음"}
  ]
}
```

정책팩: 기본(전직원 BLOCK/MASK), 고객지원(CS MASK), 개발(비밀키 BLOCK), 인사(급여평가건강 APPROVAL).

### 2.5 PDP 입출력 (원문 미수신, 요약만 수신)

요청 예시:

```json
{"request_id": "req-8f31", "tenant_id": "tenant-a",
 "pep": {"type": "browser_extension", "version": "1.2.0"},
 "actor": {"user_ref": "u_7d2a91", "groups": ["support"]},
 "destination": {"type": "external_llm", "service": "claude_web", "approved": true, "model_registry_id": "reg-claude-web-ent"},
 "content": {"channels": ["prompt"], "classification": "internal", "char_length": 412, "record_count": 1, "content_hash": "hmac-sha256:9b1e"},
 "detections": [{"type": "person_name", "count": 1, "confidence": 0.91}, {"type": "phone", "count": 1, "confidence": 0.99}],
 "cumulative": {"window": "24h", "customer_record_count": 7},
 "policy_version": "external_ai_input@3"}
```

결과 예시:

```json
{"decision_id": "dec-2c17", "request_id": "req-8f31", "action": "MASK",
 "matched_rules": ["mask_low_volume_contact_data"], "reason_codes": ["LOW_VOLUME_CUSTOMER_DATA"],
 "transformations": [{"operation": "TOKENIZE", "data_type": "person_name", "token_format": "[이름_{n}]", "scope": "session"}],
 "restore_on_response": true, "must_rescan_after_transform": true, "policy_version": "external_ai_input@3"}
```

현데모 `{"detected_categories": [...]}` 는 위 정식 스키마의 최소형태이며 서버 구현 시 확장한다.

## 3. 시스템 아키텍처 및 핵심 기능
## 4. UX/UI 및 업무 워크플로우

### 4.1 사용자 흐름

작성→배지("개인정보 2건 감지")→제출→ ALLOW 즉시전송 / MASK 미리보기후 1클릭 / APPROVAL 사유입력→대기→알림 / BLOCK 사유+대안(마스킹재시도·승인모델·값삭제) → 응답복원.
문구: 비난없이 이유·대안. 본인원문은 본인화면 로컬하이라이트, 관리자·승인자 비노출. 현구현 content.js는 배지+수동마스킹까지.
예: `김민수 고객(010-1234-5678) ...` → `[이름_1] 고객([전화_1]) ...` → 응답복원. 세션동일값 동일토큰, 변형관대매칭, P2 형식보존가명 옵션.

### 4.2 예외승인

요청(목적·모델·사유) → 바인딩(HMAC해시+모델+요청자 일회성, 1자변경 재승인) → 승인자(역할→팀장→CPO, 자기승인금지) → 화면(유형건수·등급·사유·30일이력, 원문비노출) → SLA 4h만료·1h에스컬레이션 → 알림(콘솔+메일→Slack/Teams) → 재판정·감사기록.

```json
{"approval_id": "apr-51e0", "request_id": "req-9a02", "requester_ref": "u_7d2a91",
 "binding": {"content_hash": "hmac-sha256:41aa", "destination_registry_id": "reg-claude-web-ent", "single_use": true, "expires_at": "2026-09-30T18:40:00+09:00"},
 "summary": {"detections": {"person_name": 12, "phone": 12}, "classification": "confidential"},
 "purpose": "vendor_contract_review", "status": "PENDING"}
```

### 4.3 관리자 콘솔

온보딩마법사(SSO→배포→정책팩→관찰), 대시보드(조치추이·설치율), 정책설정(문장형·시뮬·버전롤백), 승인함(건별), 이벤트로그(판정근거), 레지스트리(계정·지역·학습·보존), 보고서(ISMS-P), 오탐신고(유형만). 도입은 관찰→안내→강제 3단계.

## 5. 보안 및 데이터 보호 (Zero-Trust Privacy)

### 5.1 보존

원문 미저장(메모리), 원본파일 임시즉시삭제(격리 24h), 매핑 Vault TTL 2h, 감사메타 1년, 포렌식옵션 30일·이중승인, 운영로그 30일·원문차단.
현구현 inspect()는 범주ID만 반환(테스트검증).

### 5.2 원문미저장 통제

스왑·덤프금지·버퍼제로화, 로그필드차단+CI검사, 에러본문금지, 지원접속 승인·시한·기록.

### 5.3 토큰화

키 `tenant+session+type+HMAC(value)`, DEK암호화·KMS·연1회교체, 확장매핑 탭메모리, 프록시 Vault TTL후삭제, 복원 사내표시만. 현 mask()는 복원불가 자리표시자이며 Vault 토큰화 아님.

### 5.4 감사로그 (최소·해시체인)

```json
{"event_id": "evt-19c2", "tenant_id": "tenant-a", "actor_ref": "u_7d2a91",
 "pep": "browser_extension", "detections": {"person_name": 1, "phone": 1},
 "action": "MASK", "matched_rules": ["mask_low_volume_contact_data"],
 "policy_version": "external_ai_input@3", "payload_stored": false,
 "prev_event_hash": "sha256:7c0e", "event_hash": "sha256:2b91"}
```

가명ID, 일일앵커, 원문조각 미저장.

### 5.5 경계·규제

레지스트리 분기재검증, 테넌트논리분리·하이브리드물리분리, 연1회 모의해킹·서명검증. RRN 외부전송 non_overridable BLOCK, 가명·접속기록, 지역라우팅, ISMS-P증적.

## 6. 로드맵 및 KPI

### 6.1 단계

P1 MVP 0~8주(2파일럿, 확장·프록시·탐지·PDP·마스킹복원·승인·감사·콘솔·기본파일), P2 2~4개월(유료5사, OCR·사본·시뮬·메신저승인·출력도구·RAG·지문·보고서·하이브리드), P3 4~8개월(20사, 문맥고도화·업종팩·적응형·SIEM·BYOK).

### 6.2 P1 주차

0~1 파일럿·셋설계, 2 아키텍처·SSO·PDP스켈레톤, 3~4 엔진·확장가로채기, 4~5 프록시·토큰복원·NER, 5~6 승인·감사·콘솔, 6~7 파일·OCR, 7 레드팀, 8 관찰→강제·KPI.

팀: PM1, BE2, ML1, FE확장2, 보안0.5 = 6.5FTE.

### 6.4 성능예산 p95 300ms

로컬20+왕복60+정규식20+NER120+PDP10+토큰재검사30+여유40, 감사 비동기. 4천자·50RPS 기준, 파일 10MB 10초·OCR 장당 3초 별도.

### 6.5 KPI

지연 300ms→200ms, 가용 99.5→99.9, 재현율 95→97, 정밀도 90→95, 오탐 5→3%, 우회 80→90%, 설치율 90→98%, 통제경로 80→95%, 안전선택 85%, 승인중앙값 2h→30분, MTTA 4h, 전환 1/2사. 회귀CI 게이트.

### 6.6 가설·리스크

가격(월과금+하이브리드), 동인(사고우려+ISMS-P), 대체(DLP·금지·사내포털), 채널(MSP·컨설팅). 리스크: UI변경→원격어댑터, 누락오탐→관찰회귀, 장애→degraded, 자체유출→로컬우선, 우회→강제설치, NER지연→후보추론, 규제→전문가검토, 반발→대안UI.

## 7. MVP 완료기준

1) 양경로 전송제어 2) 안내→마스킹복원→승인바인딩→차단→감사 E2E 3) 정책버전·규칙·유형·대상 재현 4) 원문무저장 자동검증 5) degraded 기록 6) p95·재현·정밀·오탐·우회 리포트 7) 관리자 단독 온보딩.

## 부록 A. 용어

PEP 강제지점, PDP 판정엔진, 토큰화 세션대체+분리보관, degraded 로컬판정, 관찰모드 기록만.

## 부록 B. 중간점검 1차 제출 항목

### B.1 만든 것·실제동작

- docs/plan.md v1.0 신규(필수 6항+JSON예시).
- detector.js inspect() 3종검사·범주ID만 반환, mask() 수동 자리표시자.
- content.js 관찰+안내+수동마스킹(input/textarea·contenteditable 텍스트노드).
- policy.py 범주판정 ALLOW/MASK/BLOCK/APPROVAL·최엄격선택.
- 테스트 detector 5개·PDP 7개 작성. 이 작업공간 node 5/5 통과(pass5 fail0). PDP 7개는 사용자로컬 보고통과, 여기 미실행.

### B.2 확인법 (3단계)

1) `node --test browser-extension/detector.test.js` → pass5 fail0.
2) chrome://extensions 로드후 ChatGPT/Claude 새로고침→가짜4줄 입력 안내확인(실정보·전송금지).
3) docs/plan.md JSON과 pdp README 대조 범주계약 확인.

### B.3 바뀐점·이유

참고안대비 의미론 명확화(무매칭 ALLOW/APPROVAL 분리), RRN 체크섬 가중치화(2020.10 체계), 로컬1차·하이브리드 추가, 24h누적, 승인바인딩·자기승인금지, 현한계 명시.

### B.4 AI/본인 역할

AI: 구조화·JSON·정규식경계·contenteditable수정안·데모판정·테스트뼈대·정리. 본인: 가짜문구·미전송원칙, 브라우저직접확인 판단, 한계명시 결정, 재실행 다음점검 분리. 최종책임 본인.

### B.5 다음 할 일

Chrome줄바꿈 재확인, PDP 7개 재실행, 원문없는 연동·BLOCK제어·승인연결, 탐지·파일·감사확장. 최종후 RAG·도구·출력·SIEM·업종팩.

### B.6 URL·저장소

- 저장소: https://github.com/dyj02056/ai-input-protection-gateway
- 결과물: 별도배포없음. `docs/plan.md`, `browser-extension/`, `gateway-core/pdp/`, `submission_note.md`. 브라우저확인은 로컬 chrome://extensions.
- 작업공간: `c:\Users\User\Documents\ai-input-protection-gateway`


### 3.1 논리 아키텍처

확장PEP(가로채기·로컬1차탐지·안내) → Inspection API(정규화→탐지→요약) → PDP(정책평가) → Transformer(토큰화→재검사) → Token Vault(TTL매핑) + Approval + Audit(해시체인) + File Worker(격리샌드박스). API Proxy는 사내앱 요청·스트리밍·도구호출 검사. 콘솔은 정책·승인·로그·보고서.
역할분리: PEP 강제, PDP 판정, 탐지기만 원문접촉(메모리처리).

### 3.2 배포

SaaS(국내리전, 대부분 50~200명), 하이브리드(탐지·Vault·프록시 고객망), 로컬우선(애매시만 서버문의).

### 3.3 PEP 명세

확장: MV3 Chrome·Edge, 강제설치, paste/drop/input/submit 가로채기, 원격어댑터 핫픽스, 로컬탐지 20ms 목표, MASK 토큰교체, 응답복원, 파일보류, heartbeat 변조감지, 장애시 degraded+감사플래그. 현구현은 관찰+수동마스킹까지이며 자동가로채기·서버연동·복원 미구현.
프록시: OpenAI/Anthropic호환, Go→Envoy ext_proc, 가상키, SSE버퍼 재검사, tool_use 파싱·허용목록, 레지스트리 라우팅, 기본 fail-closed.

### 3.4 한국어 탐지 파이프라인

정규화(NFKC·전각·한글숫자·인코딩디코딩·제로폭제거) → 후보탐지(정규식·사전·엔트로피) → 형식검증(체크섬·발급체계; 2020.10 이후 RRN 검증번호 미적용, 가중치만) → NER(이름주소기관생년월일) → 문맥검증 → 구조분석(표헤더·행수·재식별) → 점수→PDP속성.
현구현 detector.js는 RRN형식·전화형식·일부키접두사만 다루며 NER·체크섬·문맥·구조 미구현.
NER전략: 한국어인코더 파인튜닝, ONNX양자화 p95 100ms, 합성PII+동의비식별 학습, 후보주변 추론.

### 3.5 파일·OCR

PDF텍스트 O, 스캔·이미지 OCR 5p이하, DOCX O/PPTX P2, XLSX/CSV 열단위판정, HWPX O, 구HWP 텍스트한정, ZIP 1단계, 암호화 APPROVAL/BLOCK. 샌드박스 30초 타임아웃, 즉시삭제(격리 24h). 미지원·실패는 통과시키지 않음.

### 3.6 RAG·도구·출력 (P2)

청크ACL·등급·보존기한, 사용자ACL 후필터, 컨텍스트재검사 최소전달, 도구레지스트리·대량외부전송승인, 비신뢰턴 고위험금지, 출력버퍼 재검사.

### 3.7 기술구성

확장 TS/MV3, 프록시 Go, 검사 Go+Python, OPA/Rego, ONNX CPU, NATS/RedisStreams, PG+Vault분리, OIDC/SAML·SCIM, KMS·P3 BYOK, OTel(원문로깅금지필터).

| 인코딩우회 | 정규화+디코딩검사 | 확장·프록시 | P1 |
| 파일첨부 | 파싱·OCR·표분석 | 확장·프록시 | P1/P2 |
| 소스코드 | 비밀탐지+지문대조 | 확장·프록시 | P1/P2 |
| RAG | ACL후필터·재검사 | 프록시 | P2 |
| 도구호출 | 허용목록·인자검사·승인 | 프록시 | P2 |
| 모델출력 | 스트리밍재검사 | 프록시 | P2 |
| 로그관측 | 원문미저장·필터 | 자체 | P1 |
| 인젝션 | 신뢰경계분리 | 프록시 | P2 |
| 경로우회 | 강제설치·SSO제한·모니터링 | 확장·IdP | P1/P2 |
| 게이트웨이자체 | 로컬1차·메모리처리·매핑분리 | 아키텍처 | P1 |

### 2.3 4단계 정책

| 조치 | 동작 | 예 |
|---|---|---|
| ALLOW | 원문전송 | 민감정보 없음 |
| MASK | 세션토큰 치환후전송·응답복원 | 소량 연락처 |
| REQUIRE_APPROVAL | 보류→승인시 동일내용 1회전송 | 기밀문서·미승인모델 |
| BLOCK | 미전송·대안안내 | 주민번호·전체카드·비밀키·대량정보 |

규칙: (1) 전체규칙 평가 (2) 최제한 선택(BLOCK>APPROVAL>MASK>ALLOW) (3) priority는 사유정렬·예외범위용 (4) 완화는 exception만·non_overridable 불가 (5) 무매칭: 0건 ALLOW/있음 APPROVAL (6) 변환후 재판정, BLOCK이면 승인무관 차단.
현데모대응: policy.py는 0건 ALLOW, government_id/phone MASK, api_key BLOCK, 미등록 APPROVAL, 혼합 최엄격 — 최소구현.

