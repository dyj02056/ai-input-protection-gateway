// 설정 화면의 마스킹 방식: 세션 토큰 선택과 복원 표시 스위치.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { coerceMaskStyle, coerceSettings, DEFAULT_FEATURES } from "../shared/settings.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import { OptionsApp } from "./OptionsApp.tsx";

const radio = (value: string) =>
  document.querySelector(`input[name="mask"][value="${value}"]`) as HTMLInputElement;
const restoreToggle = () => document.getElementById("f-restoreTokens") as HTMLInputElement;

async function renderOptions(initial: Record<string, unknown> = {}) {
  const stub = installChromeStub(initial);
  render(<OptionsApp />);
  await waitFor(() => expect(restoreToggle()).not.toBeNull());
  return stub;
}

describe("마스킹 방식 설정", () => {
  it("토큰 방식을 고르면 maskStyle로 저장되고, 다시 자리표시자로 돌릴 수 있다", async () => {
    const stub = await renderOptions();
    fireEvent.click(radio("token"));
    await waitFor(() => expect(stub.store.maskStyle).toBe("token"));
    expect(radio("token").checked).toBe(true);
    expect(radio("placeholder").checked).toBe(false);

    fireEvent.click(radio("placeholder"));
    await waitFor(() => expect(stub.store.maskStyle).toBe("placeholder"));
  });

  it("저장된 토큰 방식을 읽어 온다", async () => {
    await renderOptions({ maskStyle: "token" });
    expect(radio("token").checked).toBe(true);
  });

  it("복원 표시는 기본 켜짐이고, 끄면 features에 저장된다", async () => {
    const stub = await renderOptions();
    expect(restoreToggle().checked).toBe(true);
    fireEvent.click(restoreToggle());
    await waitFor(() => expect(stub.store.features).toBeDefined());
    expect((stub.store.features as Record<string, unknown>).restoreTokens).toBe(false);
  });

  it("복원이 무엇을 하는지, 무엇을 감수하는지 설정 화면에 적혀 있다", async () => {
    await renderOptions();
    const text = document.body.textContent ?? "";
    expect(text).toContain("보여주기만 하며 어디로도 전송하지 않습니다");
    expect(text).toContain("새로고침하거나 탭을 닫으면 사라집니다");
    expect(text).toContain("사이트의 스크립트가 읽을 수 있는 상태");
    expect(text).toContain("내가 보낸 메시지 말풍선은 복원하지 않습니다");
  });
});

describe("마스킹 방식 값 정리", () => {
  it("token만 받아들이고 나머지는 자리표시자로 돌린다", () => {
    expect(coerceMaskStyle("token")).toBe("token");
    expect(coerceMaskStyle("placeholder")).toBe("placeholder");
    expect(coerceMaskStyle("other")).toBe("placeholder");
    expect(coerceMaskStyle(undefined)).toBe("placeholder");
    expect(coerceMaskStyle(1)).toBe("placeholder");
    expect(coerceSettings({ maskStyle: "token" }).maskStyle).toBe("token");
    expect(coerceSettings({ maskStyle: "bogus" }).maskStyle).toBe("placeholder");
  });

  it("복원 표시의 기본값은 켜짐이고, 토큰 방식의 기본값은 꺼짐(자리표시자)이다", () => {
    expect(DEFAULT_FEATURES.restoreTokens).toBe(true);
    expect(coerceSettings({}).maskStyle).toBe("placeholder");
  });
});
