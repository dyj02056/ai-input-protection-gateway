// 파일에 대한 로컬 판정 규칙. 서버 정책(gateway-core/server/decision.py의 decide_file)과 같은 규칙이며,
// 둘이 어긋나면 `py tools/policy_parity.py`와 vitest가 같은 케이스 표(tools/policy_cases.json)로 잡아냅니다.
import type { ActionName, CategoryId } from "../../shared/categories.ts";
import type { PolicyOptions } from "../../engine/policy.ts";
import { decideLocalAction } from "../decision.ts";
import { state } from "../state.ts";
import type { FileStatus } from "./types.ts";

// 표에서 감지된 행이 이만큼 이상이면 대량 반출로 봅니다(계획서의 대량 고객정보 규칙). 조직 정책이 바꿀 수 있습니다.
export const BULK_RECORD_THRESHOLD = 100;

const priority: Readonly<Record<ActionName, number>> = { ALLOW: 1, MASK: 2, REQUIRE_APPROVAL: 3, BLOCK: 4 };

export interface FileDecisionOptions {
  // undefined: 지금 적용 중인 정책(조직 서버 정책이 있으면 그것, 없으면 내장 기본)
  // null: 내장 기본 정책(서버 정책 무시)
  // 객체: 이 정책으로 판정
  readonly policy?: PolicyOptions | null;
  readonly bulkThreshold?: number;
}

// - 감지된 것이 없으면 ALLOW.
// - 감지됐다면 정책의 판정을 따르되, 파일은 값을 가릴 수 없으므로(MASK 불가) 최소 REQUIRE_APPROVAL.
// - 표에서 감지된 행이 대량 기준 이상이면 BLOCK.
// - 검사하지 못한 파일(암호화·미지원·실패·너무 큼)은 REQUIRE_APPROVAL: 조용히 통과시키지 않습니다.
export function decideFileAction(
  status: FileStatus,
  categories: readonly CategoryId[],
  recordCount = 0,
  options: FileDecisionOptions = {},
): ActionName {
  if (status === "clean") return "ALLOW";
  if (status !== "detected") return "REQUIRE_APPROVAL";

  let action = decideLocalAction(categories, options.policy) as ActionName;
  if (priority[action] === undefined || priority[action] < priority.REQUIRE_APPROVAL) action = "REQUIRE_APPROVAL";
  const threshold = options.bulkThreshold ?? state.serverPolicy?.bulkRecordThreshold ?? BULK_RECORD_THRESHOLD;
  if (recordCount >= threshold) action = "BLOCK";
  return action;
}
