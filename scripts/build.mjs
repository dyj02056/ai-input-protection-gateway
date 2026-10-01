// 확장 빌드: dist-ext/ 에 제출·설치용 파일을 만듭니다.
//   1) 확장 페이지(popup·options·onboarding): React, vite.config.mts
//   2) 클래식 스크립트(detector.js·policy.js·background.js·content.js): 각각 하나의 IIFE로 번들합니다.
//      manifest의 content_scripts와 서비스 워커가 모듈이 아닌 일반 스크립트로 읽으므로 ES 모듈로 내면 안 됩니다.
//      읽기 쉽게 하려고 압축하지 않습니다.
// 사용법: node scripts/build.mjs [--watch]
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const EXT_ROOT = resolve(ROOT, "browser-extension");
const OUT_DIR = resolve(ROOT, "dist-ext");
const watch = process.argv.includes("--watch");

const CLASSIC_SCRIPTS = [
  { name: "detector.js", entry: "src/entries/detector.ts" },
  { name: "policy.js", entry: "src/entries/policy.ts" },
  { name: "background.js", entry: "src/background/background.ts" },
  { name: "content.js", entry: "src/content/index.ts" },
];

rmSync(OUT_DIR, { recursive: true, force: true });

await build({ configFile: resolve(ROOT, "vite.config.mts"), build: { watch: watch ? {} : null } });

for (const { name, entry } of CLASSIC_SCRIPTS) {
  await build({
    configFile: false,
    root: EXT_ROOT,
    publicDir: false,
    logLevel: "info",
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      copyPublicDir: false,
      target: "es2022",
      minify: false,
      modulePreload: false,
      watch: watch ? {} : null,
      rollupOptions: {
        input: resolve(EXT_ROOT, entry),
        output: { format: "iife", entryFileNames: name },
      },
    },
  });
}

