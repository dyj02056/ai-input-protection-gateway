// 첨부파일(선택·드롭·붙여넣기)을 감지해 이 브라우저 안에서 검사하고, 결과를 안내합니다.
//
// - 이벤트는 관찰만 합니다(preventDefault 하지 않음). 사이트의 업로드 동작을 막거나 바꾸지 않습니다.
//   사이트는 선택·드롭 즉시 업로드를 시작할 수 있어 "결과가 나올 때까지 보류"는 할 수 없습니다.
//   막을 수 있는 것은 "보내기" 단계이며, 설정에서 켠 경우에만 첫 시도를 중단합니다(sendGuard.ts).
// - 파일 내용·일치한 값은 저장하거나 전송하지 않습니다. 범주 ID와 건수만 상태에 남깁니다.
//   파일 이름은 안내창에만 표시하며 감사 기록에도 넣지 않습니다.
import { categoryDef } from "../../shared/categories.ts";
import { recordAudit, reportAction } from "../audit.ts";
import { displayNotice } from "../flow.ts";
import { detectorOptions, feature, state } from "../state.ts";
import { getDetector, NOTICE_KIND } from "../types.ts";
import { BULK_RECORD_THRESHOLD, inspectFile } from "./inspect.ts";
import { columnLetter } from "./table.ts";
import type { AttachedFile, FileFinding } from "./types.ts";

const DEDUPE_MS = 3000; // 같은 파일이 드롭과 change로 두 번 들어오는 경우를 한 번만 검사합니다
const ATTACH_TTL_MS = 15 * 60 * 1000; // 첨부로 기억하는 시간(사이트에서 파일을 뺐을 수 있어 오래 믿지 않습니다)
const MAX_TRACKED = 20;
const MAX_LISTED = 3; // 안내에 이름까지 적는 파일 수

const recent = new Map<string, number>();

// 사이트가 표시하는 이름을 읽기 좋게 줄입니다(확장자는 남깁니다).
export function shortName(name: string): string {
  if (name.length <= 36) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return `${name.slice(0, 28)}…${ext}`;
}

const labelsOf = (finding: FileFinding): string =>
  finding.categories.map((id) => categoryDef(id)?.shortLabel ?? id).join("·");

// 파일 한 개의 결과를 한 문장으로 설명합니다. 파일의 값은 쓰지 않고 이름·범주·건수만 씁니다.
export function describeFinding(finding: FileFinding): string {
  const name = shortName(finding.name);
  switch (finding.status) {
    case "detected": {
      const parts = [`${name}: ${labelsOf(finding)} 형식 감지`];
      const columns = finding.columns ?? [];
      if (columns.length > 0) {
        const sheets = new Set(columns.map((column) => column.sheet));
        const named = columns.slice(0, 4).map((column) => {
          const letter = `${columnLetter(column.column)}열`;
          return sheets.size > 1 ? `${column.sheet + 1}번 시트 ${letter}` : letter;
        });
        parts.push(`${named.join(", ")}${columns.length > 4 ? " 외" : ""}`);
      }
      if (finding.recordCount !== undefined && finding.recordCount > 0) {
        parts.push(
          `감지된 행 ${finding.recordCount}건${finding.recordCount >= BULK_RECORD_THRESHOLD ? "(대량)" : ""}`,
        );
      }
      if (finding.truncated) parts.push("일부만 검사");
      return parts.join(", ");
    }
    case "clean":
      return `${name}: 감지된 항목 없음${finding.truncated ? "(일부만 검사)" : ""}`;
    default:
      return `${name}: ${finding.reason ?? "검사하지 못했습니다"}`;
  }
}

export function describeFindings(findings: readonly FileFinding[]): string {
  const listed = findings.slice(0, MAX_LISTED).map(describeFinding);
  const rest = findings.length - listed.length;
  return `${listed.join(" / ")}${rest > 0 ? ` / 외 ${rest}개` : ""}`;
}

function fileEnforcementSentence(): string {
  return feature("enforcePolicy") && feature("blockFileSend")
    ? "첨부파일 전송 차단이 켜져 있어, 이 파일이 첨부된 채로 보내기를 누르면 첫 시도를 중단합니다."
    : "이 확장은 파일 안의 값을 가려 주지 못하니, 값을 지우거나 파일을 바꿔서 다시 첨부하세요.";
}

// 첨부로 기억하는 파일 중 아직 유효한 것. 오래된 것은 버립니다.
export function currentAttachments(now = Date.now()): AttachedFile[] {
  state.attachedFiles = state.attachedFiles.filter((attached) => now - attached.at < ATTACH_TTL_MS);
  return state.attachedFiles;
}

// 지금 보내기를 막을 이유가 있는(검사 결과가 ALLOW가 아닌) 첨부파일
export function riskyAttachments(): FileFinding[] {
  return currentAttachments()
    .map((attached) => attached.finding)
    .filter((finding) => finding.action !== "ALLOW");
}

function seenRecently(file: File, now: number): boolean {
  const key = `${file.name}|${file.size}|${file.lastModified}`;
  const before = recent.get(key);
  recent.set(key, now);
  for (const [other, at] of recent) {
    if (now - at > DEDUPE_MS * 4) recent.delete(other);
  }
  return before !== undefined && now - before < DEDUPE_MS;
}

const priority = { ALLOW: 1, MASK: 2, REQUIRE_APPROVAL: 3, BLOCK: 4 } as const;

function showResult(findings: readonly FileFinding[]): void {
  if (findings.every((finding) => finding.status === "clean")) {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "첨부파일 검사 완료",
      description: `${describeFindings(findings)}. 안전하다는 뜻은 아닙니다(지원하는 형식과 규칙에 한정됩니다). 파일은 이 브라우저 밖으로 전송되지 않았습니다.`,
    });
    return;
  }
  displayNotice({
    kind: NOTICE_KIND.ALERT,
    title: "첨부파일 검사 결과 — 전송 전 확인",
    description: `${describeFindings(findings)}. ${fileEnforcementSentence()}`,
    alertId: `file|${Date.now()}`,
  });
}

// 새로 첨부된 파일들을 검사합니다. 어떤 일이 생겨도 사이트의 동작에 영향을 주지 않도록 예외를 삼킵니다.
export async function handleFiles(files: readonly File[]): Promise<void> {
  try {
    if (!feature("inspectFiles") || files.length === 0) return;
    const now = Date.now();
    const fresh = files.filter((file) => !seenRecently(file, now));
    if (fresh.length === 0) return;

    const detector = getDetector();
    if (!detector) {
      displayNotice({
        kind: NOTICE_KIND.INFO,
        title: "로컬 검사기를 사용할 수 없습니다",
        description: "확장 프로그램을 새로고침해 주세요. 첨부파일은 검사되거나 차단되지 않았습니다.",
      });
      return;
    }

    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "첨부파일 검사 중…",
      description: `${fresh.length}개 파일을 이 브라우저 안에서 검사하고 있습니다. 파일은 어디로도 전송되지 않습니다.`,
    });

    const findings: FileFinding[] = [];
    for (const file of fresh) {
      findings.push(await inspectFile(file, { detector, options: detectorOptions() }));
    }

    const at = Date.now();
    state.attachedFiles = [
      ...currentAttachments(at),
      ...findings.map((finding) => ({ finding, at })),
    ].slice(-MAX_TRACKED);

    // 배지에는 가장 엄한 판정 이름만, 감사 기록(켠 경우)에는 범주 ID만 남깁니다. 파일 이름은 남기지 않습니다.
    const worst = findings.reduce((a, b) => (priority[b.action] > priority[a.action] ? b : a));
    reportAction(worst.action);
    for (const finding of findings) {
      if (finding.status === "detected") recordAudit(finding.action, finding.categories, "file");
    }

    showResult(findings);
  } catch {
    // 파일 검사가 실패해도 입력·전송은 그대로 동작합니다.
  }
}

const filesOf = (list: FileList | readonly File[] | null | undefined): File[] => (list ? Array.from(list) : []);

export function installFileGuard(): void {
  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "file") {
        void handleFiles(filesOf(target.files));
      }
    },
    true,
  );

  document.addEventListener(
    "drop",
    (event) => {
      void handleFiles(filesOf((event as DragEvent).dataTransfer?.files));
    },
    true,
  );

  // 붙여넣기에 파일(스크린샷 등)이 섞여 있을 때. 글자 붙여넣기는 기존 입력 검사가 맡습니다.
  document.addEventListener(
    "paste",
    (event) => {
      const files = filesOf((event as ClipboardEvent).clipboardData?.files);
      if (files.length > 0) void handleFiles(files);
    },
    true,
  );
}

// 테스트에서 상태를 비울 때 씁니다.
export function resetFileGuard(): void {
  recent.clear();
  state.attachedFiles = [];
}
