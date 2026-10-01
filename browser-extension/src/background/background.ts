// 스토어 등재용 백그라운드: 설치 시 시작 가이드 1회, 탭별 판정 배지.
// 네트워크 요청 없음. 원문·범주 ID를 저장하지 않고 판정 이름만 배지 색으로 표시합니다.
import { isSupportedUrl } from "../shared/hosts.ts";

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

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== "object") return;
  const { type, action } = message as { type?: unknown; action?: unknown };
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
