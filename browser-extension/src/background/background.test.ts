// 같은 케이스를 TS 모듈과 빌드 산출물(dist-ext/background.js)에 모두 돌립니다.
// 산출물은 서비스 워커처럼 일반 스크립트로 실행하므로, 모듈 문법이 새어 나오면 여기서 실패합니다.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { distPath } from "../test/artifact.ts";

type Handler = (...args: never[]) => void;

function createChromeMock() {
  const handlers: { installed?: Handler; updated?: Handler; message?: Handler } = {};
  const calls = {
    create: [] as unknown[],
    badgeText: [] as unknown[],
    badgeColor: [] as unknown[],
  };
  const chrome = {
    runtime: {
      onInstalled: { addListener: (h: Handler) => (handlers.installed = h) },
      onMessage: { addListener: (h: Handler) => (handlers.message = h) },
      getURL: (path: string) => `chrome-extension://abc/${path}`,
    },
    tabs: {
      onUpdated: { addListener: (h: Handler) => (handlers.updated = h) },
      create: (options: unknown) => calls.create.push(options),
    },
    action: {
      setBadgeText: (options: unknown) => calls.badgeText.push(options),
      setBadgeBackgroundColor: (options: unknown) => calls.badgeColor.push(options),
    },
  };
  return { chrome, handlers, calls };
}

type Mock = ReturnType<typeof createChromeMock>;

const variants: Array<[string, (mock: Mock) => Promise<void>]> = [
  [
    "TS 모듈",
    async (mock) => {
      vi.resetModules();
      (globalThis as { chrome?: unknown }).chrome = mock.chrome;
      await import("./background.ts");
    },
  ],
  [
    "빌드 산출물 dist-ext/background.js",
    async (mock) => {
      const context = vm.createContext({ chrome: mock.chrome, URL });
      vm.runInContext(readFileSync(distPath("background.js"), "utf8"), context, {
        filename: "background.js",
      });
    },
  ],
];

describe.each(variants)("background (%s)", (_name, run) => {
  let mock: Mock;
  const fire = (name: keyof Mock["handlers"], ...args: unknown[]) =>
    (mock.handlers[name] as unknown as (...a: unknown[]) => void)(...args);
  const fromTab = (tabId?: number) => (tabId === undefined ? {} : { tab: { id: tabId } });

  beforeEach(async () => {
    mock = createChromeMock();
    await run(mock);
  });

  it("세 가지 이벤트에 리스너를 등록한다", () => {
    expect(mock.handlers.installed).toBeTypeOf("function");
    expect(mock.handlers.updated).toBeTypeOf("function");
    expect(mock.handlers.message).toBeTypeOf("function");
  });

  it("설치할 때만 시작 가이드를 연다", () => {
    fire("installed", { reason: "update" });
    fire("installed", { reason: "chrome_update" });
    expect(mock.calls.create).toEqual([]);
    fire("installed", { reason: "install" });
    expect(mock.calls.create).toEqual([{ url: "chrome-extension://abc/onboarding.html" }]);
  });

  it("지원 사이트 페이지 로드가 끝나면 이전 배지를 지운다", () => {
    fire("updated", 7, { status: "complete" }, { url: "https://claude.ai/new" });
    expect(mock.calls.badgeText).toEqual([{ text: "", tabId: 7 }]);
  });

  it("지원하지 않는 사이트·로딩 중·주소 없음은 건드리지 않는다", () => {
    fire("updated", 1, { status: "complete" }, { url: "https://example.com/" });
    fire("updated", 2, { status: "loading" }, { url: "https://claude.ai/" });
    fire("updated", 3, { status: "complete" }, {});
    fire("updated", 4, { status: "complete" }, undefined);
    expect(mock.calls.badgeText).toEqual([]);
  });

  it.each([
    ["ALLOW", "#0e9f6e", ""],
    ["MASK", "#b77900", "!"],
    ["REQUIRE_APPROVAL", "#b77900", "!"],
    ["BLOCK", "#d92d20", "!"],
  ])("판정 %s는 배지 색 %s·문자 '%s'로 표시한다", (action, color, text) => {
    fire("message", { type: "gateway:action", action }, fromTab(5));
    expect(mock.calls.badgeColor).toEqual([{ color, tabId: 5 }]);
    expect(mock.calls.badgeText).toEqual([{ text, tabId: 5 }]);
  });

  it("알 수 없는 판정 이름은 배지를 지운다 (프로토타입 이름 포함)", () => {
    fire("message", { type: "gateway:action", action: "DELETE" }, fromTab(5));
    fire("message", { type: "gateway:action", action: "constructor" }, fromTab(5));
    fire("message", { type: "gateway:action", action: 3 }, fromTab(5));
    expect(mock.calls.badgeColor).toEqual([]);
    expect(mock.calls.badgeText).toEqual([
      { text: "", tabId: 5 },
      { text: "", tabId: 5 },
      { text: "", tabId: 5 },
    ]);
  });

  it("우리 메시지가 아니거나 탭 정보가 없으면 무시한다", () => {
    fire("message", { type: "other", action: "BLOCK" }, fromTab(5));
    fire("message", null, fromTab(5));
    fire("message", "gateway:action", fromTab(5));
    fire("message", { type: "gateway:action", action: "BLOCK" }, fromTab());
    fire("message", { type: "gateway:action", action: "BLOCK" }, undefined);
    expect(mock.calls.badgeColor).toEqual([]);
    expect(mock.calls.badgeText).toEqual([]);
  });
});
