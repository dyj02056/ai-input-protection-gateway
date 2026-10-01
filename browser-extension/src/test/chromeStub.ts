// 테스트용 chrome.* 스텁. storage.local은 get(기본값 병합)·set·remove·onChanged를 실제처럼 흉내 냅니다.
import { vi } from "vitest";

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export interface ChromeStub {
  store: Record<string, unknown>;
  sendMessage: ReturnType<typeof vi.fn>;
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

  // 확장 API는 Promise와 콜백을 모두 받습니다. 콜백 방식(콘텐츠 스크립트)도 흉내 냅니다.
  const withCallback = <T,>(result: Promise<T>, callback?: (value: T) => void): Promise<T> => {
    if (typeof callback === "function") void result.then(callback);
    return result;
  };

  const getImpl = async (keys?: string | string[] | Record<string, unknown> | null) => {
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
  };
  const setImpl = async (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: store[key], newValue: structuredClone(value) };
        store[key] = structuredClone(value);
      }
      emit(changes);
  };
  const removeImpl = async (keys: string | string[]) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in store) {
          changes[key] = { oldValue: store[key] };
          delete store[key];
        }
      }
      emit(changes);
  };

  const local = {
    get: (keys?: string | string[] | Record<string, unknown> | null, callback?: (v: Record<string, unknown>) => void) =>
      withCallback(getImpl(keys), callback),
    set: (items: Record<string, unknown>, callback?: () => void) =>
      withCallback(setImpl(items), callback),
    remove: (keys: string | string[], callback?: () => void) =>
      withCallback(removeImpl(keys), callback),
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
    runtime: {
      getManifest: () => ({ version: options.version ?? "1.1.0" }),
      sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
      lastError: undefined,
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = stub;

  return {
    store,
    sendMessage: stub.runtime.sendMessage,
    tabsQuery,
    emitChange: (key, newValue) => {
      const oldValue = store[key];
      store[key] = structuredClone(newValue);
      emit({ [key]: { oldValue, newValue } });
    },
  };
}
