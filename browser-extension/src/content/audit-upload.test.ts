// 콘텐츠 스크립트가 감사 이벤트를 백그라운드로 넘기는 조건: 별도 동의 스위치(uploadAudit)가 켜진 경우에만, 최소 내용만.
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_UPLOAD_MESSAGE } from "../shared/serverPolicy.ts";
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import { resetContentState } from "../test/contentEnv.ts";
import { recordAudit } from "./audit.ts";

let stub: ChromeStub;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const uploads = () => stub.sendMessage.mock.calls.map(([m]) => m as { type: string; event: Record<string, unknown> }).filter((m) => m.type === AUDIT_UPLOAD_MESSAGE);

beforeEach(() => {
  stub = installChromeStub();
});

describe("감사 이벤트 업로드 요청", () => {
  it("기본값에서는 아무것도 보내지 않는다", async () => {
    resetContentState();
    expect(DEFAULT_FEATURES.uploadAudit).toBe(false);
    recordAudit("BLOCK", ["api_key"]);
    await flush();
    expect(uploads()).toEqual([]);
  });

  it("스위치를 켜면 조치·범주 ID·시각·채널만 넘긴다(로컬 기록은 따로 꺼져 있으면 저장하지 않는다)", async () => {
    resetContentState({ uploadAudit: true });
    recordAudit("BLOCK", ["phone_number", "api_key"]);
    await flush();
    expect(uploads()).toHaveLength(1);
    const event = uploads()[0]!.event;
    expect(Object.keys(event).sort()).toEqual(["action", "at", "categories", "channel"]);
    expect(event).toMatchObject({ action: "BLOCK", categories: ["api_key", "phone_number"], channel: "prompt" });
    expect(stub.store.history).toBeUndefined();
  });

  it("첨부파일 판정은 channel이 file이다", async () => {
    resetContentState({ uploadAudit: true });
    recordAudit("REQUIRE_APPROVAL", ["email"], "file");
    await flush();
    expect(uploads()[0]!.event.channel).toBe("file");
  });

  it("같은 판정이 반복돼도 한 번만 넘기고, 범주가 없으면 넘기지 않는다", async () => {
    resetContentState({ uploadAudit: true });
    recordAudit("MASK", ["email"]);
    recordAudit("MASK", ["email"]);
    recordAudit("ALLOW", []);
    await flush();
    expect(uploads()).toHaveLength(1);
  });

  it("로컬 감사 기록과 업로드는 서로 독립이다", async () => {
    resetContentState({ auditLog: true });
    recordAudit("MASK", ["email"]);
    await flush();
    expect(uploads()).toEqual([]);
    expect((stub.store.history as unknown[]).length).toBe(1);
  });

  it("메시지를 보낼 수 없어도 오류 없이 넘어간다", () => {
    resetContentState({ uploadAudit: true });
    stub.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    expect(() => recordAudit("MASK", ["email"])).not.toThrow();
  });
});
