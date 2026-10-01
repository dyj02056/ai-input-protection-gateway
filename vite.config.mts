import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const EXT_ROOT = resolve(import.meta.dirname, "browser-extension");

// 번들하지 않고 그대로 복사하는 정적 파일입니다. 코드는 없고 manifest와 아이콘뿐입니다.
// (detector.js·policy.js·background.js·content.js는 scripts/build.mjs가 src/에서 만들어 dist-ext/에 넣습니다.)
// 이 목록은 제출 ZIP에 들어가는 정적 파일의 전부입니다(테스트·README·로고 시안은 제외).
const STATIC_FILES = [
  "manifest.json",
  "icons/logo.svg",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function copyStaticFiles(): Plugin {
  return {
    name: "copy-extension-static-files",
    buildStart() {
      for (const file of STATIC_FILES) this.addWatchFile(resolve(EXT_ROOT, file));
    },
    generateBundle() {
      for (const file of STATIC_FILES) {
        this.emitFile({
          type: "asset",
          fileName: file,
          source: readFileSync(resolve(EXT_ROOT, file)),
        });
      }
    },
  };
}

export default defineConfig({
  root: EXT_ROOT,
  base: "./",
  publicDir: false,
  plugins: [react(), copyStaticFiles()],
  build: {
    outDir: resolve(import.meta.dirname, "dist-ext"),
    // dist-ext/ 비우기는 scripts/build.mjs가 한 번만 합니다(이어서 클래식 스크립트를 같은 폴더에 만들기 때문).
    emptyOutDir: false,
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(EXT_ROOT, "popup.html"),
        options: resolve(EXT_ROOT, "options.html"),
        onboarding: resolve(EXT_ROOT, "onboarding.html"),
      },
    },
  },
  test: {
    root: import.meta.dirname,
    environment: "jsdom",
    include: ["browser-extension/src/**/*.test.{ts,tsx}"],
    setupFiles: ["browser-extension/src/test/setup.ts"],
  },
});
