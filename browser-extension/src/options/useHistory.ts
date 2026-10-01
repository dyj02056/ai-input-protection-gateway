import { useCallback, useEffect, useState } from "react";
import { clearHistory, loadHistory, type HistoryEntry } from "../shared/settings.ts";

// 감사 기록을 읽어 최신순으로 돌려줍니다. 다른 탭이나 페이지(내용 변경 스크립트)가 기록을 남기면
// storage.onChanged로 표시를 갱신합니다.
export function useHistory(): { rows: HistoryEntry[]; clear: () => Promise<void> } {
  const [rows, setRows] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const next = await loadHistory();
      if (alive) setRows(next);
    };
    void refresh();

    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "history")) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const clear = useCallback(async () => {
    await clearHistory();
    setRows(await loadHistory());
  }, []);

  return { rows, clear };
}
