import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installChromeStub } from "../test/chromeStub.ts";
import { PopupApp } from "./PopupApp.tsx";

const statusText = () => document.getElementById("status-text")!.textContent;
const indicator = () => document.querySelector(".status-indicator")!;

describe("PopupApp", () => {
  it("지원 사이트 탭이면 보호 동작 중으로 표시한다", async () => {
    installChromeStub({}, { tabUrl: "https://claude.ai/new" });
    render(<PopupApp />);
    await waitFor(() => expect(statusText()).toBe("지원 사이트에서 보호 동작 중"));
    expect(indicator().classList.contains("ok")).toBe(true);
  });

  it("다른 사이트면 지원하지 않는다고 표시한다", async () => {
    installChromeStub({}, { tabUrl: "https://example.com/" });
    render(<PopupApp />);
    await waitFor(() =>
      expect(statusText()).toBe("지원 사이트(ChatGPT · Claude · Gemini)가 아닙니다"),
    );
    expect(indicator().classList.contains("off")).toBe(true);
  });

  it("탭 주소를 읽을 수 없으면(권한 없음) 지원하지 않음으로 본다", async () => {
    installChromeStub({}, { tabUrl: undefined });
    render(<PopupApp />);
    await waitFor(() => expect(indicator().classList.contains("off")).toBe(true));
  });

  it("탭 조회가 실패해도 오류 없이 지원하지 않음으로 표시한다", async () => {
    installChromeStub({}, { tabsReject: true });
    render(<PopupApp />);
    await waitFor(() => expect(indicator().classList.contains("off")).toBe(true));
  });

  it("확인 중에는 상태 색을 정하지 않는다", () => {
    installChromeStub({}, { tabUrl: "https://claude.ai/" });
    render(<PopupApp />);
    expect(statusText()).toBe("지금 탭 상태 확인 중…");
    expect(indicator().className).toBe("status-indicator");
  });

  it("버전을 manifest에서 읽어 표시한다", async () => {
    installChromeStub({}, { tabUrl: "https://claude.ai/", version: "9.8.7" });
    const { container } = render(<PopupApp />);
    expect(container.querySelector(".eyebrow")!.textContent).toBe(
      "AI 입력정보 보호 게이트웨이 v9.8.7",
    );
    await waitFor(() => expect(indicator().classList.contains("ok")).toBe(true));
  });
});
