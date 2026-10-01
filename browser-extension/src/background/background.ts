// 스토어 등재용 백그라운드: 설치 시 시작 가이드 1회, 탭별 판정 배지.
// 서버를 연결하지 않으면 네트워크 요청이 없습니다(연결한 경우의 요청은 policySync·auditUpload·approvals가 맡습니다).
// 원문·범주 ID를 저장하지 않고 판정 이름만 배지 색으로 표시합니다.
import { APPROVAL_MESSAGE } from "../shared/approval.ts";
import { isSupportedUrl } from "../shared/hosts.ts";
import { AUDIT_UPLOAD_MESSAGE, POLICY_PROBE_MESSAGE, POLICY_SYNC_MESSAGE } from "../shared/serverPolicy.ts";
import { handleApproval } from "./approvals.ts";
import { chromeAuditDeps, enqueueAudit, flushAudit } from "./auditUpload.ts";
import { chromeDeps, probeServer, syncPolicy } from "./policySync.ts";

interface BadgeStyle {
  readonly color: string;
  readonly text: string;
}

// content.js가 보내는 판정 이름 → 배지 색/문자
const BADGE_STYLES: ReadonlyMap<string, BadgeStyle> = new Map([
  ["ALLOW", { color: "#0e9f6e", text: "" }],
  ["MASK", { color: "#b77900", text: "!" }],
  ["REQUIRE_APPROVAL", { color: "#b77900", text: "!" }],
  ["BLOCK", { color: "#d92d20", text: "!" }],
]);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});

// 페이지를 새로 열 때 이전 배지를 지웁니다. 검사가 실행되면 다시 채워집니다.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab || !tab.url) return;
  if (isSupportedUrl(tab.url)) {
    void chrome.action.setBadgeText({ text: "", tabId });
  }
});

// 확장 자신의 화면(설정·팝업)에서 온 메시지인지. 설정 화면은 브라우저 탭으로 열리므로 sender.tab만으로는 웹 페이지와 구분되지 않습니다.
// 콘텐츠 스크립트(웹 페이지의 탭)는 sender.url이 그 웹 페이지 주소이므로, 확장 주소(chrome-extension://…)로 시작할 수 없습니다.
function fromExtensionPage(sender: chrome.runtime.MessageSender | undefined): boolean {
  if (!sender || !sender.tab) return true;
  try {
    return typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== "object") return;
  const { type, action } = message as { type?: unknown; action?: unknown };

  // 조직 정책 동기화: 콘텐츠 스크립트(탭)는 "확인해 달라"고만 요청할 수 있고, 즉시 강제 확인과 연결 시험은 확장 화면만 합니다.
  if (type === POLICY_SYNC_MESSAGE) {
    const force = fromExtensionPage(sender) && (message as { force?: unknown }).force === true;
    syncPolicy(chromeDeps(), force).then(
      (status) => respond(status),
      () => respond(null),
    );
    // 못 보낸 감사 이벤트가 있으면 이때 다시 시도합니다(동의가 꺼져 있으면 쌓인 것을 지웁니다).
    flushAudit(chromeAuditDeps(chromeDeps()), force).catch(() => undefined);
    return true; // 응답을 비동기로 돌려줍니다
  }
  // 감사 이벤트 업로드: 탭(콘텐츠 스크립트)에서 온 것만 받고, 동의 스위치·서버 연결 여부는 enqueueAudit이 확인합니다.
  if (type === AUDIT_UPLOAD_MESSAGE) {
    if (fromExtensionPage(sender)) return;
    enqueueAudit(chromeAuditDeps(chromeDeps()), (message as { event?: unknown }).event).catch(() => undefined);
    return;
  }
  // 승인 요청: 탭(콘텐츠 스크립트)에서 온 것만 받습니다. 요청·상태 확인·승인 사용을 서버에 전달하고 결과만 돌려줍니다.
  if (type === APPROVAL_MESSAGE) {
    if (fromExtensionPage(sender)) return;
    handleApproval(chromeDeps(), message).then(
      (reply) => respond(reply),
      () => respond({ ok: false, error: "승인 요청을 처리하지 못했습니다." }),
    );
    return true;
  }
  if (type === POLICY_PROBE_MESSAGE) {
    if (!fromExtensionPage(sender)) return; // 웹 페이지(콘텐츠 스크립트)에서 온 요청은 받지 않습니다
    const { url, key } = message as { url?: unknown; key?: unknown };
    probeServer(chromeDeps(), typeof url === "string" ? url : "", typeof key === "string" ? key : "").then(
      (status) => respond(status),
      () => respond(null),
    );
    return true;
  }

  if (type !== "gateway:action") return;

  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (typeof tabId !== "number") return;

  const style = typeof action === "string" ? BADGE_STYLES.get(action) : undefined;
  if (!style) {
    void chrome.action.setBadgeText({ text: "", tabId });
    return;
  }

  void chrome.action.setBadgeBackgroundColor({ color: style.color, tabId });
  void chrome.action.setBadgeText({ text: style.text, tabId });
});
