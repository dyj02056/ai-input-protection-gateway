// 파일 판정과 조직 정책 적용. 서버(gateway-core/server)와 같은 케이스 표(tools/policy_cases.json)를 씁니다.
// 같은 표를 `py tools/policy_parity.py`가 서버 쪽 코드로 다시 확인하므로, 어느 한쪽 규칙만 바뀌면 실패합니다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CategoryId } from "../../shared/categories.ts";
import { parseServerPolicy, toEngineOptions, type ServerPolicy } from "../../shared/serverPolicy.ts";
import { REPO_ROOT } from "../../test/artifact.ts";
import { installEngines, removeEngines, resetContentState } from "../../test/contentEnv.ts";
import { decideLocalAction, policyName } from "../decision.ts";
import { state } from "../state.ts";
import { BULK_RECORD_THRESHOLD, decideFileAction } from "./decide.ts";
import type { FileStatus } from "./types.ts";

interface Shared {
  custom_policy: Record<string, unknown>;
  policy_cases: Array<{ name: string; categories: string[]; action: string }>;
  file_cases: Array<{
    name: string;
    policy: "default" | "custom";
    status: FileStatus;
    categories: CategoryId[];
    recordCount: number;
    action: string;
  }>;
}

const shared = JSON.parse(readFileSync(resolve(REPO_ROOT, "tools", "policy_cases.json"), "utf8")) as Shared;
const custom: ServerPolicy = parseServerPolicy(shared.custom_policy, 0);

beforeEach(() => {
  installEngines();
  resetContentState();
});
afterEach(() => removeEngines());

describe("공용 케이스 표 — 조직 정책으로 판정", () => {
  it("케이스 표를 읽었다", () => {
    expect(shared.policy_cases.length).toBeGreaterThan(3);
    expect(shared.file_cases.length).toBeGreaterThan(8);
  });

  it.each(shared.policy_cases.map((item) => [item.name, item] as const))("%s", (_name, item) => {
    expect(decideLocalAction(item.categories, toEngineOptions(custom))).toBe(item.action);
  });

  it.each(shared.policy_cases.map((item) => [item.name, item] as const))("%s (엔진이 없을 때 폴백도 같다)", (_name, item) => {
    removeEngines();
    expect(decideLocalAction(item.categories, toEngineOptions(custom))).toBe(item.action);
  });
});

describe("공용 케이스 표 — 첨부파일 판정", () => {
  it.each(shared.file_cases.map((item) => [item.name, item] as const))("%s", (_name, item) => {
    const options =
      item.policy === "custom"
        ? { policy: toEngineOptions(custom), bulkThreshold: custom.bulkRecordThreshold }
        : { policy: null };
    expect(decideFileAction(item.status, item.categories, item.recordCount, options)).toBe(item.action);
  });
});

describe("조직 정책이 적용 중일 때 (state.serverPolicy)", () => {
  it("정책이 없으면 내장 기본 정책으로 판정하고 이름은 '로컬 정책'이다", () => {
    expect(state.serverPolicy).toBeNull();
    expect(decideLocalAction(["email"])).toBe("MASK");
    expect(policyName()).toBe("로컬 정책");
  });

  it("정책이 있으면 인자 없이 부른 판정에 그 정책이 쓰이고, 이름에 버전이 붙는다", () => {
    state.serverPolicy = custom;
    expect(decideLocalAction(["email"])).toBe("BLOCK");
    expect(decideLocalAction(["phone_number"])).toBe("ALLOW");
    expect(policyName()).toBe("조직 정책(v7)");
  });

  it("policy 인자에 null을 주면 서버 정책을 무시하고 내장 기본으로 판정한다", () => {
    state.serverPolicy = custom;
    expect(decideLocalAction(["email"], null)).toBe("MASK");
  });

  it("조직 정책의 대량 기준(50)이 파일 판정에 쓰이고, 없으면 100이다", () => {
    expect(BULK_RECORD_THRESHOLD).toBe(100);
    expect(decideFileAction("detected", ["phone_number"], 60)).toBe("REQUIRE_APPROVAL");
    state.serverPolicy = custom;
    expect(decideFileAction("detected", ["phone_number"], 60)).toBe("BLOCK");
    expect(decideFileAction("detected", ["phone_number"], 49)).toBe("REQUIRE_APPROVAL");
  });

  it("조직 정책이 전부 허용이어도 파일에서 감지됐으면 승인 검토 이상이다(값을 가릴 수 없다)", () => {
    state.serverPolicy = parseServerPolicy(
      { ...shared.custom_policy, category_actions: { phone_number: "ALLOW" }, unknown_category_action: "ALLOW" },
      0,
    );
    expect(decideLocalAction(["phone_number"])).toBe("ALLOW");
    expect(decideFileAction("detected", ["phone_number"], 1)).toBe("REQUIRE_APPROVAL");
  });

  it("검사하지 못한 파일은 조직 정책이 무엇이든 승인 검토다", () => {
    state.serverPolicy = parseServerPolicy(
      { ...shared.custom_policy, category_actions: { phone_number: "ALLOW" }, unknown_category_action: "ALLOW" },
      0,
    );
    for (const status of ["encrypted", "uninspected", "too-large", "failed"] as const) {
      expect(decideFileAction(status, [], 0)).toBe("REQUIRE_APPROVAL");
    }
  });
});
