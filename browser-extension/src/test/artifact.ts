// 빌드된 클래식 스크립트(dist-ext/*.js)를 실제 확장처럼 빈 전역에서 실행해 노출된 전역 객체를 돌려줍니다.
// TS 모듈이 아니라 "배포되는 파일"을 검사하기 위한 도우미입니다.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const DIST_DIR = resolve(REPO_ROOT, "dist-ext");

export function distPath(file: string): string {
  const path = resolve(DIST_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`dist-ext/${file}이 없습니다. 먼저 'npm run build'를 실행하세요.`);
  }
  return path;
}

export function loadArtifactGlobal<T>(file: string, globalName: string): T {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(distPath(file), "utf8"), context, { filename: file });
  const value = (context as Record<string, unknown>)[globalName];
  if (value === undefined) {
    throw new Error(`${file}이 전역 ${globalName}을 노출하지 않습니다.`);
  }
  return value as T;
}

// vm 렐름의 TypeError는 호스트의 TypeError와 다른 생성자라 instanceof가 false가 됩니다.
// 이름과 형태만 확인합니다.
export function isTypeError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "TypeError" &&
    Object.prototype.toString.call(error) === "[object Error]"
  );
}

export function throwsTypeError(fn: () => unknown): boolean {
  try {
    fn();
  } catch (error) {
    return isTypeError(error);
  }
  return false;
}
