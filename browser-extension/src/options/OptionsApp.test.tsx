import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_IDS } from "../shared/categories.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import { OptionsApp } from "./OptionsApp.tsx";

const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;
const radio = (name: string, value: string) =>
  document.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement;

async function renderOptions(initial: Record<string, unknown> = {}) {
  const stub = installChromeStub(initial);
  render(<OptionsApp />);
  await waitFor(() => expect(checkbox("c-email")).not.toBeNull());
  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OptionsApp 기본값", () => {
  it("새로 설치하면 표시 기능만 켜져 있고 막는 기능은 모두 꺼져 있다", async () => {
    await renderOptions();
    for (const id of ["f-persistentAlert", "f-autoCloseWhenClean", "f-undoButton"]) {
      expect(checkbox(id).checked, id).toBe(true);
    }
    for (const id of ["f-auditLog", "f-enforcePolicy", "f-blockSend", "f-requireConfirm"]) {
      expect(checkbox(id).checked, id).toBe(false);
    }
    for (const id of ["c-government_id", "c-phone_number", "c-email", "c-api_key"]) {
      expect(checkbox(id).checked, id).toBe(true);
    }
    expect(radio("noticePosition", "top-right").checked).toBe(true);
    expect(radio("mask", "placeholder").checked).toBe(true);
  });

  it("세션 토큰 마스킹을 고를 수 있고, 기본은 자리표시자다", async () => {
    await renderOptions();
    expect(radio("mask", "token").disabled).toBe(false);
    expect(radio("mask", "token").checked).toBe(false);
    expect(radio("mask", "placeholder").checked).toBe(true);
  });

  it("화면을 열기만 해서는 저장소에 아무것도 쓰지 않는다", async () => {
    const stub = await renderOptions();
    expect(stub.store).toEqual({});
  });

  it("저장된 값을 화면에 반영한다", async () => {
    await renderOptions({
      enabled: { email: false },
      features: { blockSend: true, noticePosition: "bottom-left", undoButton: false },
    });
    expect(checkbox("c-email").checked).toBe(false);
    expect(checkbox("c-phone_number").checked).toBe(true);
    expect(checkbox("f-blockSend").checked).toBe(true);
    expect(checkbox("f-undoButton").checked).toBe(false);
    expect(radio("noticePosition", "bottom-left").checked).toBe(true);
  });
});

describe("OptionsApp 저장", () => {
  it("스위치를 켜면 바로 저장하고, 나머지 값은 그대로 둔다", async () => {
    const stub = await renderOptions({ features: { resultAutoHideMs: 3000 } });
    fireEvent.click(checkbox("f-blockSend"));
    await waitFor(() => expect(stub.store.features).toBeDefined());

    const features = stub.store.features as Record<string, unknown>;
    expect(features.blockSend).toBe(true);
    expect(features.enforcePolicy).toBe(false);
    expect(features.resultAutoHideMs).toBe(3000);
    expect(stub.store.maskStyle).toBe("placeholder");
    expect(checkbox("f-blockSend").checked).toBe(true);
  });

  it("탐지 항목을 끄면 enabled에 저장된다", async () => {
    const stub = await renderOptions();
    fireEvent.click(checkbox("c-phone_number"));
    await waitFor(() => expect(stub.store.enabled).toBeDefined());
    // 등록부의 모든 범주가 저장되고, 끈 것만 false다.
    expect(stub.store.enabled).toEqual({
      ...Object.fromEntries(CATEGORY_IDS.map((id) => [id, true])),
      phone_number: false,
    });
  });

  it("안내창 위치를 바꾸면 저장된다", async () => {
    const stub = await renderOptions();
    fireEvent.click(radio("noticePosition", "bottom-left"));
    await waitFor(() => expect(stub.store.features).toBeDefined());
    expect((stub.store.features as Record<string, unknown>).noticePosition).toBe("bottom-left");
    expect(radio("noticePosition", "top-right").checked).toBe(false);
  });
});

describe("OptionsApp 감사 기록", () => {
  it("기록이 없으면 안내 문구를 보여주고 표를 숨긴다", async () => {
    await renderOptions();
    expect(document.getElementById("audit")!.hidden).toBe(true);
    expect(document.getElementById("audit-empty")!.hidden).toBe(false);
  });

  it("기록을 최신순으로 한글 이름과 함께 보여준다", async () => {
    await renderOptions({
      history: [
        { at: 1000, action: "MASK", categories: ["phone_number", "email"] },
        { at: 2000, action: "BLOCK", categories: ["api_key"] },
      ],
    });
    const rows = [...document.querySelectorAll("#audit-body tr")].map((tr) => tr.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("차단(BLOCK)");
    expect(rows[0]).toContain("API 키");
    expect(rows[1]).toContain("마스킹(MASK)");
    expect(rows[1]).toContain("전화번호, 이메일");
    expect(document.getElementById("audit")!.hidden).toBe(false);
    expect(document.getElementById("audit-empty")!.hidden).toBe(true);
  });

  it("다른 곳에서 기록이 추가되면 화면이 갱신된다", async () => {
    const stub = await renderOptions();
    act(() => {
      stub.emitChange("history", [{ at: 5, action: "MASK", categories: ["email"] }]);
    });
    await waitFor(() => expect(document.querySelectorAll("#audit-body tr")).toHaveLength(1));
  });

  it("전체 삭제는 기록과 마지막 판정을 지우고 알린다", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const stub = await renderOptions({
      history: [{ at: 1, action: "MASK", categories: ["email"] }],
      lastAction: "MASK",
      features: { auditLog: true },
    });
    expect(document.querySelectorAll("#audit-body tr")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "로컬 기록 전체 삭제" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("로컬 기록을 삭제했습니다."));

    expect(stub.store).not.toHaveProperty("history");
    expect(stub.store).not.toHaveProperty("lastAction");
    expect(stub.store.features).toEqual({ auditLog: true });
    expect(document.querySelectorAll("#audit-body tr")).toHaveLength(0);
    expect(document.getElementById("audit-empty")!.hidden).toBe(false);
  });
});
