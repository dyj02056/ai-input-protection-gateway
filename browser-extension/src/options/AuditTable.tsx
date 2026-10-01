import { ACTION_LABELS, labelForCategory } from "../shared/constants.ts";
import type { HistoryEntry } from "../shared/settings.ts";

// 표에는 시각·조치·범주 ID만 들어갑니다. 원문과 일치한 문자열은 저장되지 않으므로 그릴 수도 없습니다.
export function AuditTable({ rows }: { rows: HistoryEntry[] }) {
  return (
    <>
      <table id="audit" hidden={rows.length === 0}>
        <thead>
          <tr>
            <th>시각</th>
            <th>조치</th>
            <th>범주</th>
          </tr>
        </thead>
        <tbody id="audit-body">
          {rows.map((entry, index) => (
            <tr key={`${entry.at}-${index}`}>
              <td>{new Date(entry.at).toLocaleString()}</td>
              <td>{ACTION_LABELS[entry.action] || entry.action || "—"}</td>
              <td>
                {entry.categories.length ? entry.categories.map(labelForCategory).join(", ") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="empty" id="audit-empty" hidden={rows.length > 0}>
        기록이 없습니다. 감사 기록을 켠 뒤 입력 검사를 실행하면 여기에 남습니다.
      </p>
    </>
  );
}
