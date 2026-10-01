# 중소기업용 생성형 AI 입력정보 보호 게이트웨이 제작 계획서

> 문서 버전: v1.1 (Pages 데모 포함) / 작성일: 2026-10-01
> 배포 URL(예정): https://dyj02056.github.io/ai-input-protection-gateway/
> 관련 구현: `browser-extension/`, `gateway-core/pdp/`, `submission_note.md`

## 0. 요약

| 항목 | 내용 |
|---|---|
| 제품 정의 | 외부 AI 입력·첨부·전송을 전송 직전에 검사하고 ALLOW/MASK/APPROVAL/BLOCK을 강제하며 원문 없이 감사 기록을 남기는 게이트웨이 |
| 목표 고객 | 50~500명 중소기업 (우선 B2B SaaS, 커머스, 고객센터, 개발 조직) |
| 도입 형태 | 1) 브라우저 확장 2) API 프록시 |
| 현 구현 | 확장 로컬 탐지 3종+수동 마스킹, PDP 데모 판정. 자동 차단·서버 연동 미구현 |
| 배포 | GitHub Pages 정적 데모 (`docs/index.html`, `docs/demo.html`). 서버 전송 없음 |
| 목표·일정 | p95 300ms, 재현율 95%+, 오탐 5% 이하. P1 0~8주 / P2 2~4개월 / P3 4~8개월 |

원칙: 게이트웨이가 흐름 통제, 원문 미저장·로컬 1차 탐지, 마스킹·승인 안전 통과 경로.

## 1. 개요 및 배경

문제: 무통제 붙여넣기·업로드, 정규식 한계·경고피로, 일괄차단 역효과, RAG·도구·출력 신경로, 인력 0~2명 중소기업 현실.
판정 속성: 유형·민감도·건수·누적, 역할·부서, 목적, 대상 서비스·계정·지역·학습사용, 문서등급·채널.
고객: 결정자(대표·CTO), 운영(IT·보안·CPO), 승인자(팀장·CPO), 사용자(상담·영업·개발). ICP는 100~300명·개인정보 대량보유·ISMS-P.
가치: 1일 적용·정책팩, 4단계 강제, 마스킹후 응답복원, 원문없는 재현, 원문미저장·하이브리드.
범위 MVP: 확장 MV3, OpenAI/Anthropic 프록시, 주민·전화·키 등 우선탐지, 파일 PDF/DOCX/XLSX/HWPX(구HWP 텍스트한정, OCR 5p). 제외: 모바일·데스크톱앱, 웹출력재검사, RAG·SIEM, 100% 보장. 현구현은 3종+수동마스킹까지.

## 2. 위협 모델 및 제어 정책

자산: 개인정보·기밀·코드자격증명. 행위자: 부주의(최우선), 우회(높음), 간접공격(높음), 악의(감사억지).
경로: 프롬프트·분할누적(24h 카운터)·인코딩(정규화)·파일(파싱OCR)·코드(지문)·RAG(ACL)·도구(허용목록)·출력(버퍼재검사)·로그(미저장)·인젝션(경계분리)·우회(강제설치)·자체(메모리·분리).
조치: ALLOW 원문전송, MASK 토큰치환·복원, APPROVAL 보류후 1회전송, BLOCK 미전송·대안. 전체평가후 최제한, priority는 정렬용, 완화는 exception만(non_overridable 불가), 무매칭 0건 ALLOW/있음 APPROVAL, 변환후 재판정.
데모대응: policy.py는 0건 ALLOW, government_id/phone MASK, api_key BLOCK, 미등록 APPROVAL, 혼합 최엄격.

### 2.4 정책 JSON 예시

## 3. 아키텍처 및 핵심 기능

확장PEP(가로채기·로컬탐지 detector.js)→검사API(정규화→탐지→요약)→PDP(판정)→Transformer(토큰화)→Vault(TTL)+승인+감사(해시체인)+파일Worker(격리). 프록시는 요청·SSE·tool_use 검사. 배포는 SaaS/하이브리드/로컬우선. 현구현은 관찰+수동마스킹까지.
탐지: 정규화(NFKC·전각·한글숫자·디코딩)→정규식→체크섬(2020.10 RRN 가중치만)→NER→문맥→구조→PDP속성. detector.js는 3종만, NER·체크섬·구조 미구현.
파일: PDF·DOCX·XLSX열판정·HWPX·구HWP텍스트·ZIP1단계·암호화 APPROVAL/BLOCK, 30초 타임아웃 즉시삭제.
기술: 확장MV3, Go 프록시, Go+Python, OPA/Rego, ONNX CPU, PG+Vault분리, OIDC/SCIM, KMS, OTel 원문차단.

## 4. UX 및 워크플로우

작성→배지→ ALLOW 즉시 / MASK 미리보기후 1클릭 / APPROVAL 사유→대기→알림 / BLOCK 사유+대안 → 응답복원. 본인화면 로컬하이라이트, 승인자 원문비노출. content.js는 배지+수동마스킹까지.
승인: HMAC바인딩 일회성·1자변경 재승인·자기승인금지·SLA 4h·1h에스컬레이션·재판정.
콘솔: 온보딩·대시보드·문장형정책·시뮬·승인함·로그·레지스트리·ISMS-P보고서·오탐유형수집. 관찰→안내→강제.

## 5. 보안 및 데이터 보호

원문미저장(메모리), 파일즉시삭제(격리24h), Vault TTL2h, 감사1년, 포렌식옵션30일·이중승인, 로그30일 원문차단. inspect() 범주ID만 반환. 스왑덤프금지·로그필터·에러본문금지. 키 tenant+session+HMAC, DEK·KMS. 현 mask()는 복원불가 자리표시자.
감사: `{"action":"MASK","policy_version":"external_ai_input@3","payload_stored":false}` + 해시체인·가명ID.
규제: RRN non_overridable BLOCK, 지역라우팅, ISMS-P증적.

## 6. 로드맵 및 KPI

P1 0~8주(2파일럿·확장·프록시·탐지·PDP·마스킹복원·승인·감사·콘솔), P2 2~4개월(유료5사·OCR·사본·메신저승인·출력도구·RAG·보고서·하이브리드), P3 4~8개월(20사·적응형·SIEM·BYOK).
예산 p95 300ms=로컬20+왕복60+정규식20+NER120+PDP10+재검사30+여유40.
KPI: 지연300→200ms, 재현율95→97, 정밀90→95, 오탐5→3%, 우회80→90%, 설치90→98%.
MVP완료: 양경로제어·E2E·재현·무저장검증·degraded기록·리포트·단독온보딩.

## 부록 B. 중간점검 1차

B.1 만든 것: plan v1.1, Pages index/demo, detector inspect/mask, content.js 수동마스킹, policy.py 판정, 테스트 5+7개. node 5/5 통과.
B.2 확인법: (1) 배포URL demo 가짜4줄 (2) node 테스트 pass5 (3) chrome 확장 가짜입력.
B.3 바뀐 점: Pages 데모 추가(심사 접근성), 의미론 분리·RRN가중치·누적·바인딩 유지.
B.4 AI/본인: AI 구조화·데모구현, 본인 검증원칙·한계명시·배포결정. 최종책임 본인.
B.5 다음: Chrome재확인·PDP재실행·연동·BLOCK·승인·탐지확장.
B.6 URL: 배포 https://dyj02056.github.io/ai-input-protection-gateway/demo.html (Pages 설정후 유효), 저장소 https://github.com/dyj02056/ai-input-protection-gateway.

```json
{"policy_id": "external_ai_input", "version": 3, "fallback": {"no_detection": "ALLOW", "with_detection": "REQUIRE_APPROVAL"},
 "rules": [{"id": "block_prohibited_identifiers", "priority": 1000, "non_overridable": true, "action": "BLOCK"},
  {"id": "block_bulk_customer_data", "priority": 900, "action": "BLOCK"},
  {"id": "approve_confidential_document", "priority": 800, "action": "REQUIRE_APPROVAL"},
  {"id": "mask_low_volume_contact_data", "priority": 700, "action": "MASK"}]}
```

### 2.5 PDP 입출력 (원문 미수신)

요청: `{"detected_categories": ["government_id"]}` (데모 최소형) → 정식 스키마로 확장.
결과: `{"action": "MASK", "reason_codes": ["LOW_VOLUME_CUSTOMER_DATA"], "restore_on_response": true}`.
