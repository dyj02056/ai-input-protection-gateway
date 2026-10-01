// 설정 화면의 탐지 관련 항목: 새 범주 목록, 엄격 검증 스위치, 허용 목록 입력란.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../shared/categories.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import { OptionsApp } from "./OptionsApp.tsx";

const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;
const allowlist = () => document.getElementById("allowlist") as HTMLTextAreaElement;

async function renderOptions(initial: Record<string, unknown> = {}) {
  const stub = installChromeStub(initial);
  render(<OptionsApp />);
  await waitFor(() => expect(allowlist()).not.toBeNull());
  return stub;
}

describe("탐지 항목 목록", () => {
  it("등록부의 모든 범주가 스위치로 나오고 기본은 모두 켜져 있다", async () => {
    await renderOptions();
    for (const category of CATEGORIES) {
      expect(checkbox(`c-${category.id}`), category.id).not.toBeNull();
      expect(checkbox(`c-${category.id}`).checked, category.id).toBe(true);
    }
    expect(document.body.textContent).toContain(`탐지 항목 (${CATEGORIES.length}종)`);
  });

  it("BLOCK 판정 항목에는 자동으로 막지 않는다는 말이 함께 있다", async () => {
    await renderOptions();
    const label = (id: string) => checkbox(id).closest("label")!.textContent ?? "";
    expect(label("c-credit_card")).toContain("BLOCK");
    expect(label("c-credit_card")).toContain("기본값은 자동 차단 없음");
    expect(label("c-phone_number")).not.toContain("자동 차단 없음");
  });

  it("새 범주를 끄면 저장된다", async () => {
    const stub = await renderOptions();
    fireEvent.click(checkbox("c-bank_account"));
    await waitFor(() => expect(stub.store.enabled).toBeDefined());
    expect((stub.store.enabled as Record<string, boolean>).bank_account).toBe(false);
    expect((stub.store.enabled as Record<string, boolean>).credit_card).toBe(true);
  });
});

describe("엄격 검증", () => {
  it("기본은 꺼져 있고, 켜면 features에 저장된다", async () => {
    const stub = await renderOptions();
    expect(checkbox("f-strictValidation").checked).toBe(false);
    fireEvent.click(checkbox("f-strictValidation"));
    await waitFor(() => expect(stub.store.features).toBeDefined());
    expect((stub.store.features as Record<string, unknown>).strictValidation).toBe(true);
  });
});

describe("허용 목록", () => {
  it("저장된 목록을 한 줄에 하나씩 보여준다", async () => {
    await renderOptions({ allowlist: ["02-123-4567", "support@example.com"] });
    expect(allowlist().value).toBe("02-123-4567\nsupport@example.com");
  });

  it("입력란에서 벗어날 때 정리해서 저장한다", async () => {
    const stub = await renderOptions();
    fireEvent.change(allowlist(), { target: { value: " 02-123-4567 \n\nsupport@example.com\n02-123-4567" } });
    // 입력 중에는 저장하지 않는다.
    expect(stub.store.allowlist).toBeUndefined();
    fireEvent.blur(allowlist());
    await waitFor(() => expect(stub.store.allowlist).toBeDefined());
    expect(stub.store.allowlist).toEqual(["02-123-4567", "support@example.com"]);
    expect(allowlist().value).toBe("02-123-4567\nsupport@example.com");
  });

  it("바뀐 것이 없으면 저장하지 않는다", async () => {
    const stub = await renderOptions({ allowlist: ["a"] });
    fireEvent.blur(allowlist());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stub.store).toEqual({ allowlist: ["a"] });
  });

  it("전부 지우면 빈 목록으로 저장한다", async () => {
    const stub = await renderOptions({ allowlist: ["a"] });
    fireEvent.change(allowlist(), { target: { value: "" } });
    fireEvent.blur(allowlist());
    await waitFor(() => expect(stub.store.allowlist).toEqual([]));
  });

  it("개인정보 안내: 이 브라우저에만 저장되고 전송되지 않는다고 알린다", async () => {
    await renderOptions();
    expect(document.body.textContent).toContain("이 브라우저에 그대로 저장");
    expect(document.body.textContent).toContain("어디로도 전송되지 않습니다");
  });
});
