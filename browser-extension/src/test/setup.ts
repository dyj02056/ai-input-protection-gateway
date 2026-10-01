import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  delete (globalThis as { chrome?: unknown }).chrome;
  // 콘텐츠 스크립트 테스트가 문서에 남긴 요소를 치웁니다.
  document.querySelectorAll("[data-ai-input-gateway-notice]").forEach((host) => host.remove());
  document.body.innerHTML = "";
});
