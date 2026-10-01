// 설정 화면의 첨부파일 검사 항목.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { coerceFeatures, DEFAULT_FEATURES } from "../shared/settings.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import { OptionsApp } from "./OptionsApp.tsx";

const toggle = (id: string) => document.getElementById(id) as HTMLInputElement;

async function renderOptions(initial: Record<string, unknown> = {}) {
  const stub = installChromeStub(initial);
  render(<OptionsApp />);
  await waitFor(() => expect(toggle("f-inspectFiles")).not.toBeNull());
  return stub;
}

describe("첨부파일 검사 설정", () => {
  it("검사는 기본 켜짐, 첨부파일 전송 차단은 기본 꺼짐이다", async () => {
    await renderOptions();
    expect(toggle("f-inspectFiles").checked).toBe(true);
    expect(toggle("f-blockFileSend").checked).toBe(false);
    expect(DEFAULT_FEATURES.inspectFiles).toBe(true);
    expect(DEFAULT_FEATURES.blockFileSend).toBe(false);
  });

  it("전송 차단을 켜면 features에 저장되고, 다른 값은 그대로다", async () => {
    const stub = await renderOptions({ features: { resultAutoHideMs: 3000 } });
    fireEvent.click(toggle("f-blockFileSend"));
    await waitFor(() => expect(stub.store.features).toBeDefined());
    const features = stub.store.features as Record<string, unknown>;
    expect(features.blockFileSend).toBe(true);
    expect(features.inspectFiles).toBe(true);
    expect(features.blockSend).toBe(false);
    expect(features.resultAutoHideMs).toBe(3000);
  });

  it("검사를 끌 수 있다", async () => {
    const stub = await renderOptions();
    fireEvent.click(toggle("f-inspectFiles"));
    await waitFor(() => expect(stub.store.features).toBeDefined());
    expect((stub.store.features as Record<string, unknown>).inspectFiles).toBe(false);
  });

  it("무엇을 검사하고 무엇을 못 하는지, 전송되지 않는다는 것을 알린다", async () => {
    await renderOptions();
    const text = document.body.textContent ?? "";
    expect(text).toContain("이 브라우저 안에서만");
    expect(text).toContain("파일은 어디로도");
    expect(text).toContain("전송·저장하지 않고");
    expect(text).toContain(".docx");
    expect(text).toContain(".xlsx");
    expect(text).toContain(".hwpx");
    expect(text).toContain("업로드 자체는 막지 못합니다");
    expect(text).toContain("검사하지 못했다");
    expect(text).toContain("로컬 정책 적용");
  });

  it("이전 버전에서 저장된 설정에는 없던 키라서 기본값으로 읽힌다", () => {
    const legacy = coerceFeatures({ persistentAlert: true, blockSend: true });
    expect(legacy.inspectFiles).toBe(true);
    expect(legacy.blockFileSend).toBe(false);
    expect(coerceFeatures({ blockFileSend: "yes" }).blockFileSend).toBe(false);
  });
});
