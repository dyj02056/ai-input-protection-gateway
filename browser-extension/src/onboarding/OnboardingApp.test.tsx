import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OnboardingApp } from "./OnboardingApp.tsx";

describe("OnboardingApp", () => {
  it("체험용 가짜 문구 3줄을 줄바꿈 그대로 보여준다", () => {
    const { container } = render(<OnboardingApp />);
    const sample = container.querySelector("pre code")!.textContent;
    expect(sample).toBe(
      "가짜 주민번호 000000-1000000\n가짜 전화번호 010-0000-0000\n가짜 이메일 test.user@example.com",
    );
  });

  it("기본값은 막지 않고, 차단을 켜도 5초 안에 재시도하면 전송됨을 알린다", () => {
    const { container } = render(<OnboardingApp />);
    const text = container.textContent ?? "";
    expect(text).toContain("기본 설정에서는 아무것도 막지 않고 안내만 합니다");
    expect(text).toContain("5초 안에 한 번 더 누르면 그대로 전송됩니다");
  });
});
