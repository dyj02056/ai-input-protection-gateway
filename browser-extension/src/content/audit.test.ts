import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import { resetContentState } from "../test/contentEnv.ts";
import { AUDIT_LIMIT, recordAudit, reportAction } from "./audit.ts";
import { applySettings, state, watchSettings } from "./state.ts";

let stub: ChromeStub;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const history = () => (stub.store.history ?? []) as Array<Record<string, unknown>>;

describe("감사 기록", () => {
  beforeEach(() => {
    stub = installChromeStub();
    resetContentState({ auditLog: true });
  });

  it("기본값(꺼짐)에서는 아무것도 저장하지 않는다", async () => {
    resetContentState();
    recordAudit("MASK", ["email"]);
    await flush();
    expect(stub.store).toEqual({});
  });

  it("판정 이름·범주 ID·시각만 저장한다", async () => {
    recordAudit("MASK", ["phone_number", "email"]);
    await flush();
    expect(history()).toHaveLength(1);
    const entry = history()[0]!;
    expect(Object.keys(entry).sort()).toEqual(["action", "at", "categories"]);
    expect(entry.action).toBe("MASK");
    expect(entry.categories).toEqual(["email", "phone_number"]);
    expect(typeof entry.at).toBe("number");
  });

  it("범주가 없으면 저장하지 않는다", async () => {
    recordAudit("ALLOW", []);
    await flush();
    expect(stub.store).toEqual({});
  });

  it("같은 판정이 반복되면(숫자를 한 자씩 입력) 한 번만 남긴다", async () => {
    recordAudit("MASK", ["email"]);
    await flush();
    recordAudit("MASK", ["email"]);
    await flush();
    expect(history()).toHaveLength(1);
    recordAudit("BLOCK", ["api_key"]);
    await flush();
    expect(history()).toHaveLength(2);
  });

  it(`최근 ${AUDIT_LIMIT}건만 남긴다`, async () => {
    for (let index = 0; index < AUDIT_LIMIT + 5; index += 1) {
      recordAudit(index % 2 === 0 ? "MASK" : "BLOCK", [`c${index}`]);
      await flush();
    }
    const rows = history();
    expect(rows).toHaveLength(AUDIT_LIMIT);
    expect(rows.at(-1)!.categories).toEqual([`c${AUDIT_LIMIT + 4}`]);
    expect(rows[0]!.categories).toEqual(["c5"]);
  });
});

describe("배지용 판정 알림", () => {
  it("판정 이름만 보낸다 (범주 ID·원문은 보내지 않는다)", () => {
    stub = installChromeStub();
    reportAction("BLOCK");
    expect(stub.sendMessage).toHaveBeenCalledTimes(1);
    expect(stub.sendMessage.mock.calls[0]![0]).toEqual({ type: "gateway:action", action: "BLOCK" });
  });

  it("서비스 워커가 없어 오류가 나도 조용히 넘어간다", () => {
    stub = installChromeStub();
    stub.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated");
    });
    expect(() => reportAction("MASK")).not.toThrow();
  });
});

describe("설정 반영", () => {
  beforeEach(() => resetContentState());

  it("끈 범주를 목록으로 모으고, 모르는 값은 무시한다", () => {
    applySettings({ enabled: { email: false, phone_number: true, nope: false } });
    expect(state.disabledCategories).toEqual(["email"]);
  });

  it("features는 타입에 맞게 받아들이고 이상한 값은 기본값으로 되돌린다", () => {
    applySettings({ features: { blockSend: "yes", noticePosition: "bottom-left", resultAutoHideMs: -1 } });
    expect(state.features.blockSend).toBe(false);
    expect(state.features.noticePosition).toBe("bottom-left");
    expect(state.features.resultAutoHideMs).toBe(8000);
  });

  it("비어 있거나 잘못된 입력은 현재 설정을 바꾸지 않는다", () => {
    state.disabledCategories = ["email"];
    applySettings(null);
    applySettings(undefined);
    applySettings({});
    expect(state.disabledCategories).toEqual(["email"]);
  });

  it("저장소의 값을 읽어 적용하고, 이후 변경도 바로 반영한다", async () => {
    stub = installChromeStub({
      enabled: { api_key: false },
      features: { undoButton: false },
    });
    const onChanged = vi.fn();
    watchSettings(onChanged);
    await flush();
    expect(state.disabledCategories).toEqual(["api_key"]);
    expect(state.features.undoButton).toBe(false);

    stub.emitChange("features", { blockSend: true, noticePosition: "bottom-left" });
    expect(state.features.blockSend).toBe(true);
    expect(state.features.noticePosition).toBe("bottom-left");
    // 바뀌지 않은 키(enabled)는 그대로 유지된다.
    expect(state.disabledCategories).toEqual(["api_key"]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("저장소를 쓸 수 없는 환경에서는 기본값으로만 동작한다", () => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
    expect(() => watchSettings(() => {})).not.toThrow();
  });
});
