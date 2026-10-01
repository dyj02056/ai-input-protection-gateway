// 팝업 상태: 현재 탭이 보호 대상인지만 표시합니다. 서버 요청·원문 접근 없음.
// 확장은 `tabs` 권한을 쓰지 않으므로, 대상 사이트가 아닌 탭에서는 tab.url을 읽을 수 없습니다.
const SUPPORTED_HOSTS = ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com"];
const NOT_SUPPORTED = "지원 사이트(ChatGPT · Claude · Gemini)가 아닙니다";

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const el = document.getElementById("status-text");
  const dot = document.querySelector(".status-indicator");

  function paint(ok, text) {
    el.textContent = text;
    dot.classList.toggle("ok", ok);
    dot.classList.toggle("off", !ok);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const hostname = hostnameOf(tab && tab.url);
    const ok =
      hostname !== "" && SUPPORTED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
    paint(ok, ok ? "지원 사이트에서 보호 동작 중" : NOT_SUPPORTED);
  } catch {
    paint(false, NOT_SUPPORTED);
  }
});

