// 공개 사이트(GitHub Pages)를 만듭니다. 결과물은 저장소의 docs/ 폴더에 생기며, Pages는 그 폴더를 그대로 배포합니다.
// 따라서 docs/는 전부 생성물입니다. 직접 고치지 말고 site/ 아래를 고친 뒤 `npm run build:docs`를 실행하세요.
//
// - Astro는 outDir을 먼저 비웁니다. 손으로 쓰는 문서(plan.md, store-listing.md)는 documents/에 둡니다.
// - 파일 이름은 기존 주소(index.html, demo.html …)를 그대로 유지합니다(개인정보 처리방침 URL은 스토어에 등록돼 있습니다).
// - 자산 폴더 이름은 assets입니다. 기본값 _astro는 밑줄로 시작해 GitHub Pages(Jekyll)가 무시합니다.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const ROOT = import.meta.dirname;
const ICONS_FROM = resolve(ROOT, "../browser-extension/icons");

// 확장 아이콘의 원본은 browser-extension/icons/ 하나입니다. 사이트에는 빌드할 때 복사합니다.
function copyExtensionIcons() {
  return {
    name: "copy-extension-icons",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const out = resolve(fileURLToPath(dir), "icons");
        mkdirSync(out, { recursive: true });
        for (const file of readdirSync(ICONS_FROM)) copyFileSync(resolve(ICONS_FROM, file), resolve(out, file));
      },
    },
  };
}

export default defineConfig({
  // GitHub Pages 프로젝트 사이트는 https://<사용자>.github.io/ai-input-protection-gateway/ 아래에서 서비스됩니다.
  // 자산(JS·CSS) 경로가 이 접두사를 가져야 합니다. 페이지 사이의 링크는 상대 경로라 영향이 없습니다.
  base: "/ai-input-protection-gateway",
  outDir: "../docs",
  build: { format: "file", assets: "assets" },
  trailingSlash: "ignore",
  // 태그 사이의 공백을 지우면 인라인 요소(버튼 등)의 간격이 달라집니다. 원래 모양을 지키려고 압축하지 않습니다.
  compressHTML: false,
  devToolbar: { enabled: false },
  integrations: [copyExtensionIcons()],
});
