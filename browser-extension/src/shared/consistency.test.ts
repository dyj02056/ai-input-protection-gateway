// manifest.json은 코드가 아니라 번들되지 않으므로 지원 호스트 목록을 따로 가지고 있습니다.
// 한쪽만 고쳐서 어긋나는 일을 막기 위해 원본 파일에서 값을 읽어 대조합니다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_HOSTS } from "./constants.ts";

const EXT = resolve(import.meta.dirname, "../..");
const read = (name: string) => readFileSync(resolve(EXT, name), "utf8");

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
});

describe("manifest.json 서버 연동 설정", () => {
  const manifest = () =>
    JSON.parse(read("manifest.json")) as {
      version: string;
      permissions: string[];
      host_permissions: string[];
      optional_host_permissions?: string[];
      content_scripts: Array<{ matches: string[] }>;
    };

  it("서버 주소 권한은 필수가 아니라 선택(optional)이고, 로컬 개발용 http는 localhost·127.0.0.1만 허용한다", () => {
    const { optional_host_permissions: optional, host_permissions: required, permissions } = manifest();
    expect(optional).toEqual(["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]);
    // 설치 시점에 요구하는 권한에는 서버 주소가 없다: 지원 사이트 4곳과 storage뿐이다
    expect(required).toHaveLength(SUPPORTED_HOSTS.length);
    expect(permissions).toEqual(["storage"]);
  });

  it("콘텐츠 스크립트는 지원 사이트에서만 돈다(선택 권한이 콘텐츠 스크립트를 넓히지 않는다)", () => {
    const hosts = manifest().content_scripts[0]!.matches.map((pattern) => new URL(pattern.replace("/*", "/")).hostname);
    expect(hosts.sort()).toEqual([...SUPPORTED_HOSTS].sort());
  });

  it("manifest.json과 package.json의 버전이 같다", () => {
    const pkg = JSON.parse(readFileSync(resolve(EXT, "..", "package.json"), "utf8")) as { version: string };
    expect(manifest().version).toBe(pkg.version);
  });
});

