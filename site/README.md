# 공개 사이트 (GitHub Pages)

[Astro](https://astro.build)로 만든 정적 사이트입니다. 홈(`index`)·로컬 탐지 데모(`demo`)·계획서 요약(`plan`)·개인정보 처리방침(`privacy`)·아이콘 미리보기(`logo-preview`) 5개 페이지입니다.

## 꼭 알아둘 것

**`docs/`는 전부 생성물입니다. 직접 고치지 마세요.** GitHub Pages가 `docs/` 폴더를 그대로 배포하므로 결과물을 거기에 두었고(Pages 설정을 바꿀 필요가 없습니다), 빌드할 때마다 Astro가 `docs/`를 먼저 비웁니다. 고칠 때는 이 폴더(`site/`)를 고친 뒤 빌드하고, 바뀐 `docs/`를 함께 커밋하세요.

```bash
npm run build:docs   # site/ → docs/
npm run dev:docs     # 로컬에서 미리보기 (http://localhost:4321/ai-input-protection-gateway/)
```

Node.js 22.12 이상이 필요합니다(Astro 요구 사항). 확장 빌드(`npm run build`)는 20.19 이상이면 됩니다.

## 구성

| 경로 | 역할 |
|---|---|
| `src/pages/*.astro` | 페이지. 파일 이름이 곧 주소입니다(`privacy.astro` → `privacy.html`). **개인정보 처리방침 URL은 스토어에 등록돼 있으므로 이름을 바꾸지 마세요** |
| `src/layouts/Base.astro` | 모든 페이지의 `<head>`와 공통 스타일 |
| `src/components/SiteNav.astro` | 계획서·개인정보·아이콘 페이지 맨 위 링크 줄 |
| `src/styles/base.css` | 공통 색·글꼴. 페이지별 배치는 각 페이지의 `<style>`에 있습니다 |
| `src/scripts/demo.ts` | 데모 동작. 확장에 들어가는 `browser-extension/src/engine/detector.ts`·`policy.ts`를 **직접 가져다 쓰므로** 탐지 코드의 사본이 없습니다 |
| `public/.nojekyll` | GitHub Pages(Jekyll)가 파일을 걸러내지 않게 합니다 |

- 확장 버전은 `browser-extension/manifest.json`에서 읽어 홈·개인정보 처리방침에 넣습니다. 버전을 올려도 문구를 따로 고칠 필요가 없습니다.
- 아이콘은 `browser-extension/icons/`가 원본이며, 빌드할 때 `docs/icons/`로 복사됩니다.
- 손으로 쓰는 문서(`plan.md`, `store-listing.md`)는 빌드가 지우지 않도록 저장소의 `documents/`에 있습니다.

## 설정에서 지킨 것

- `base: "/ai-input-protection-gateway"` — 프로젝트 사이트는 이 경로 아래에서 서비스되므로 JS·CSS 경로에 접두사가 필요합니다. 저장소 이름을 바꾸면 함께 바꿔야 합니다.
- `build.assets: "assets"` — 기본값 `_astro`는 밑줄로 시작해 Jekyll이 무시합니다.
- `compressHTML: false` — 태그 사이 공백을 지우면 버튼 같은 인라인 요소의 간격이 달라집니다.
