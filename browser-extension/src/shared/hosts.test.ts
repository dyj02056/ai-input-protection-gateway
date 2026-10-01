import { describe, expect, it } from "vitest";
import { isSupportedUrl } from "./hosts.ts";

describe("isSupportedUrl", () => {
  it.each([
    "https://chatgpt.com/c/abc",
    "https://chat.openai.com/",
    "https://claude.ai/new",
    "https://gemini.google.com/app",
    "https://www.chatgpt.com/",
  ])("지원 사이트: %s", (url) => {
    expect(isSupportedUrl(url)).toBe(true);
  });

  it.each([
    "https://example.com/",
    "https://evilchatgpt.com/",
    "https://chatgpt.com.evil.example/",
    "not a url",
    "",
    undefined,
  ])("지원하지 않음: %s", (url) => {
    expect(isSupportedUrl(url)).toBe(false);
  });
});
