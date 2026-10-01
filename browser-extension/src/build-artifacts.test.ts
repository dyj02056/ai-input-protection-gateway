// 배포되는 dist-ext/가 manifest의 약속대로 만들어졌는지 확인합니다. 먼저 'npm run build'가 필요합니다.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { distPath, REPO_ROOT } from "./test/artifact.ts";

interface Manifest {
  icons: Record<string, string>;
  action: { default_popup: string };
  options_page: string;
  background: { service_worker: string };
  content_scripts: Array<{ js: string[] }>;
}

const read = (file: string) => readFileSync(distPath(file), "utf8");
const manifest = () => JSON.parse(read("manifest.json")) as Manifest;

describe("dist-ext 산출물", () => {
  it("manifest가 가리키는 파일이 모두 있다", () => {
    const m = manifest();
    const referenced = [
      ...Object.values(m.icons),
      m.action.default_popup,
      m.options_page,
      m.background.service_worker,
      ...m.content_scripts.flatMap((script) => script.js),
    ];
    for (const file of referenced) expect(existsSync(distPath(file)), file).toBe(true);
  });

  it("클래식 스크립트에 모듈 문법(import/export)이 없다", () => {
    // content_scripts와 서비스 워커는 모듈이 아닌 일반 스크립트로 읽힙니다.
    const m = manifest();
    const scripts = [m.background.service_worker, ...m.content_scripts.flatMap((s) => s.js)];
    for (const file of scripts) {
      expect(/^\s*(import|export)\s/m.test(read(file)), `${file}에 모듈 문법`).toBe(false);
    }
  });

  it("content_scripts 순서대로 읽으면 content.js가 쓰는 두 전역이 모두 생긴다", () => {
    const [scripts] = manifest().content_scripts.map((s) => s.js);
    expect(scripts).toEqual(["detector.js", "policy.js", "content.js"]);
    const context = vm.createContext({});
    for (const file of ["detector.js", "policy.js"]) {
      vm.runInContext(read(file), context, { filename: file });
    }
    const globals = context as Record<string, Record<string, unknown>>;
    expect(globals.AIInputGatewayDetector).toBeDefined();
    expect(globals.AIInputGatewayPolicy).toBeDefined();
    expect(Object.keys(globals.AIInputGatewayDetector!).sort()).toEqual([
      "applyMatches",
      "findMatches",
      "inspect",
      "mask",
    ]);
  });

  it("확장 페이지 HTML이 소스(.tsx)가 아니라 빌드된 스크립트를 가리킨다", () => {
    for (const page of ["popup.html", "options.html", "onboarding.html"]) {
      const html = read(page);
      expect(html, page).not.toMatch(/\.tsx?["']/);
      expect(html, page).toMatch(/src="\.\/assets\/[^"]+\.js"/);
    }
  });
});
