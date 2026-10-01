// content.js·background.js는 아직 번들 밖의 별도 파일이라 같은 값을 따로 가지고 있습니다.
// 한쪽만 고쳐서 어긋나는 일을 막기 위해 원본 파일에서 값을 읽어 대조합니다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_HOSTS } from "./constants.ts";
import { DEFAULT_FEATURES } from "./settings.ts";

const EXT = resolve(import.meta.dirname, "../..");
const read = (name: string) => readFileSync(resolve(EXT, name), "utf8");

describe("content.js와 같은 기본 설정", () => {
  it("DEFAULT_FEATURES가 content.js와 일치한다", () => {
    const match = /const DEFAULT_FEATURES = Object\.freeze\((\{[\s\S]*?\})\);/.exec(read("content.js"));
    expect(match).not.toBeNull();
    const fromContent = new Function(`return ${match![1]}`)() as Record<string, unknown>;
    expect(DEFAULT_FEATURES).toEqual(fromContent);
  });
});

describe("지원 호스트 목록", () => {
  const hostsOf = (patterns: string[]) =>
    patterns.map((pattern) => new URL(pattern.replace("/*", "/")).hostname).sort();

  it("manifest.json의 host_permissions·content_scripts와 일치한다", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      host_permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };
    const expected = [...SUPPORTED_HOSTS].sort();
    expect(hostsOf(manifest.host_permissions)).toEqual(expected);
    expect(hostsOf(manifest.content_scripts[0]!.matches)).toEqual(expected);
  });

  it("background.js의 SUPPORTED_HOSTS와 일치한다", () => {
    const match = /const SUPPORTED_HOSTS = (\[[^\]]*\]);/.exec(read("background.js"));
    expect(match).not.toBeNull();
    const fromBackground = JSON.parse(match![1]!) as string[];
    expect([...fromBackground].sort()).toEqual([...SUPPORTED_HOSTS].sort());
  });
});
