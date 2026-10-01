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
    storage: {
      local: {
        // 서버 연동 설정이 없는 상태(기본)를 흉내 냅니다.
        get: async () => ({}),
        set: async () => undefined,
      },
    },
    permissions: { contains: async () => false },
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

  describe("조직 정책 동기화 메시지", () => {
    const ask = (message: unknown, sender: unknown) =>
      new Promise<unknown>((resolve) => {
        const result = (mock.handlers.message as unknown as (...a: unknown[]) => unknown)(message, sender, resolve);
        // 응답을 비동기로 돌려주지 않는 요청이면 undefined가 돌아오므로 곧바로 끝냅니다.
        if (result !== true) resolve("no-response");
      });

    it("탭(콘텐츠 스크립트)이 동기화를 요청하면 응답을 비동기로 돌려준다(연동이 꺼져 있으면 off)", async () => {
      const response = (await ask({ type: "gateway:policy-sync" }, fromTab(3))) as { state: string };
      expect(response.state).toBe("off");
    });

    // 실제 크롬에서 설정 화면은 브라우저 탭으로 열려 sender.tab이 있고, sender.url이 확장 주소입니다.
    const optionsTab = { tab: { id: 9 }, url: "chrome-extension://abc/options.html" };
    const webPage = (tabId: number) => ({ tab: { id: tabId }, url: "https://claude.ai/new" });

    it("탭으로 열린 설정 화면에서 온 연결 시험·강제 동기화도 처리한다(웹 페이지와 주소로 구분)", async () => {
      const probe = (await ask({ type: "gateway:policy-probe", url: "http://127.0.0.1:1", key: "x".repeat(20) }, optionsTab)) as { state: string; message: string };
      expect(probe.state).toBe("error");
      expect(probe.message).toContain("권한"); // 응답이 왔다는 뜻(이전에는 응답 자체가 없었다)
      const sync = (await ask({ type: "gateway:policy-sync", force: true }, optionsTab)) as { state: string };
      expect(sync.state).toBe("off");
    });

    it("웹 페이지(콘텐츠 스크립트)는 탭 정보가 있어도 연결 시험을 못 하고, 승인 요청·감사 전송은 할 수 있다", async () => {
      expect(await ask({ type: "gateway:policy-probe", url: "http://127.0.0.1:1", key: "x".repeat(20) }, webPage(4))).toBe("no-response");
      const approval = (await ask({ type: "gateway:approval", op: "status", id: "ab".repeat(16) }, webPage(4))) as { ok: boolean };
      expect(approval.ok).toBe(false);
      // 확장 화면이 보낸 승인 요청은 받지 않는다
      expect(await ask({ type: "gateway:approval", op: "status", id: "ab".repeat(16) }, optionsTab)).toBe("no-response");
    });

    it("웹 페이지가 확장 주소로 보이게 꾸밀 수는 없다: 주소가 확장으로 시작하지 않으면 확장 화면이 아니다", async () => {
      const spoof = { tab: { id: 4 }, url: "https://evil.example/?chrome-extension://abc/" };
      expect(await ask({ type: "gateway:policy-probe", url: "http://127.0.0.1:1", key: "x".repeat(20) }, spoof)).toBe("no-response");
    });

    it("확장 화면(설정)의 동기화 요청도 처리한다", async () => {
      const response = (await ask({ type: "gateway:policy-sync", force: true }, {})) as { state: string };
      expect(response.state).toBe("off");
    });

    it("연결 시험은 탭에서 온 요청이면 받지 않는다(웹 페이지가 있는 곳에서는 키·주소를 넣어 호출할 수 없다)", async () => {
      const response = await ask(
        { type: "gateway:policy-probe", url: "http://127.0.0.1:1", key: "x".repeat(20) },
        fromTab(3),
      );
      expect(response).toBe("no-response");
    });

    it("확장 화면에서 온 연결 시험은 처리하고, 권한이 없으면 실패로 답한다", async () => {
      const response = (await ask(
        { type: "gateway:policy-probe", url: "http://127.0.0.1:1", key: "x".repeat(20) },
        {},
      )) as { state: string; message: string };
      expect(response.state).toBe("error");
      expect(response.message).toContain("권한");
    });

    it("값이 이상한 연결 시험은 실패로 답한다", async () => {
      const response = (await ask({ type: "gateway:policy-probe", url: 3, key: null }, {})) as { state: string };
      expect(response.state).toBe("error");
    });

    it("승인 요청은 탭(콘텐츠 스크립트)에서 온 것만 받고, 동의·연결이 없으면 실패로 답한다", async () => {
      const message = { type: "gateway:approval", op: "create", categories: ["email"], purpose: "other", note: "" };
      const fromPage = (await ask(message, fromTab(3))) as { ok: boolean };
      expect(fromPage.ok).toBe(false);
      // 확장 화면(탭이 아닌 곳)에서 온 승인 요청은 받지 않는다
      expect(await ask(message, {})).toBe("no-response");
      expect(await ask(message, undefined)).toBe("no-response");
    });
  });
});
