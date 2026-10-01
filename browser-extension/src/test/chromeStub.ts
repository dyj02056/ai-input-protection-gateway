// 테스트용 chrome.* 스텁. storage.local은 get(기본값 병합)·set·remove·onChanged를 실제처럼 흉내 냅니다.
import { vi } from "vitest";

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export interface ChromeStub {
  store: Record<string, unknown>;
  tabsQuery: ReturnType<typeof vi.fn>;
  emitChange: (key: string, newValue: unknown) => void;
}

export function installChromeStub(
  initial: Record<string, unknown> = {},
  options: { tabUrl?: string | undefined; tabsReject?: boolean; version?: string } = {},
): ChromeStub {
  const store: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<Listener>();

  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    for (const listener of [...listeners]) listener(changes, "local");
  };

  const local = {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      if (keys == null) return structuredClone(store);
      if (typeof keys === "string") keys = [keys];
      const result: Record<string, unknown> = {};
      if (Array.isArray(keys)) {
        for (const key of keys) if (key in store) result[key] = structuredClone(store[key]);
      } else {
        for (const [key, fallback] of Object.entries(keys)) {
          result[key] = structuredClone(key in store ? store[key] : fallback);
        }
      }
      return result;
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: store[key], newValue: structuredClone(value) };
        store[key] = structuredClone(value);
      }
      emit(changes);
    },
    async remove(keys: string | string[]) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in store) {
          changes[key] = { oldValue: store[key] };
          delete store[key];
        }
      }
      emit(changes);
    },
  };

  const tabsQuery = vi.fn(async () => {
    if (options.tabsReject) throw new Error("tabs unavailable");
    return [{ url: options.tabUrl }];
  });

  const stub = {
    storage: {
      local,
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
    tabs: { query: tabsQuery },
    runtime: { getManifest: () => ({ version: options.version ?? "1.1.0" }) },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = stub;

  return {
    store,
    tabsQuery,
    emitChange: (key, newValue) => {
      const oldValue = store[key];
      store[key] = structuredClone(newValue);
      emit({ [key]: { oldValue, newValue } });
    },
  };
}
