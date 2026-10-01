// 팝업 상태: 현재 탭이 보호 대상인지만 표시합니다. 서버 요청·원문 접근 없음.
// 확장은 `tabs` 권한을 쓰지 않으므로, 대상 사이트가 아닌 탭에서는 tab.url을 읽을 수 없습니다.
import { useEffect, useState } from "react";
import { isSupportedUrl } from "../shared/hosts.ts";

const NOT_SUPPORTED = "지원 사이트(ChatGPT · Claude · Gemini)가 아닙니다";

type Status = { kind: "checking" } | { kind: "ok" } | { kind: "off"; text: string };

async function checkActiveTab(): Promise<Status> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return isSupportedUrl(tab?.url)
      ? { kind: "ok" }
      : { kind: "off", text: NOT_SUPPORTED };
  } catch {
    return { kind: "off", text: NOT_SUPPORTED };
  }
}

export function PopupApp() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const version = chrome.runtime.getManifest().version;

  useEffect(() => {
    let alive = true;
    void checkActiveTab().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const text =
    status.kind === "checking"
      ? "지금 탭 상태 확인 중…"
      : status.kind === "ok"
        ? "지원 사이트에서 보호 동작 중"
        : status.text;
  const indicatorClass =
    status.kind === "ok"
      ? "status-indicator ok"
      : status.kind === "off"
        ? "status-indicator off"
        : "status-indicator";

  return (
    <main className="panel">
      <p className="eyebrow">AI 입력정보 보호 게이트웨이 v{version}</p>
      <h1>보내기 전 검사 · 마스킹</h1>
      <p className="status" role="status">
        <span className={indicatorClass} aria-hidden="true"></span>
        <span id="status-text">{text}</span>
      </p>

      <section aria-labelledby="scope-heading">
        <h2 id="scope-heading">지원 사이트</h2>
        <p>
          ChatGPT · Claude · Gemini 웹 입력창에서 로컬 검사합니다. 다른 사이트에서는 동작하지
          않습니다.
        </p>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading">30초 사용법</h2>
        <ol className="how">
          <li>가짜 문구로 입력·붙여넣기 (실정보 금지, 전송 금지)</li>
          <li>안내 표시 확인 → 마스킹 버튼 클릭</li>
          <li>결과 확인 후 필요하면 실행 취소</li>
          <li>안내는 시간 지나 사라지지 않으니 필요할 때만 ×로 닫기</li>
        </ol>
      </section>

      <div className="links">
        <a href="onboarding.html" target="_blank">
          시작 가이드
        </a>
        <a href="options.html" target="_blank">
          설정
        </a>
        <a
          href="https://dyj02056.github.io/ai-input-protection-gateway/demo.html"
          target="_blank"
          rel="noopener"
        >
          로컬 데모
        </a>
      </div>

      <p className="notice">
        입력 내용 서버 전송 없음 · 기본값은 자동 차단 없음(전송 차단은 설정에서 켤 수 있음) · 감지 안내는
        닫을 때까지 계속 표시되고 마스킹은 자리표시자 대체이며 되돌리기 1회 지원. 가짜 테스트
        문구만 사용하고 전송하지 마세요.
      </p>
    </main>
  );
}
