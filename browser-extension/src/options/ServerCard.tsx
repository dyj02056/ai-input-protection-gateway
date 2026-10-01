// 조직 PDP 서버 연동 카드. 기본은 연결 없음(네트워크 요청 없음)이며, 연결하면 "정책을 내려받기만" 합니다.
// 입력한 글·파일·감지 결과는 서버로 보내지 않습니다. API 키는 이 화면에서 직접 입력하고, 코드나 설정 파일에는 두지 않습니다.
import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "../shared/categories.ts";
import {
  checkServerUrl,
  isPlausibleApiKey,
  POLICY_PROBE_MESSAGE,
  POLICY_SYNC_MESSAGE,
  readServerConfig,
  readStoredPolicy,
  readSyncStatus,
  SERVER_KEYS,
  type ServerPolicy,
  type SyncStatus,
} from "../shared/serverPolicy.ts";

const ACTION_TEXT: Readonly<Record<string, string>> = {
  ALLOW: "허용",
  MASK: "마스킹",
  REQUIRE_APPROVAL: "승인 검토",
  BLOCK: "차단 판정",
};

interface Loaded {
  readonly url: string;
  readonly enabled: boolean;
  readonly hasKey: boolean;
  readonly policy: ServerPolicy | null;
  readonly status: SyncStatus | null;
}

const EMPTY: Loaded = { url: "", enabled: false, hasKey: false, policy: null, status: null };

async function loadServerState(): Promise<Loaded> {
  const data = await chrome.storage.local.get([
    SERVER_KEYS.config,
    SERVER_KEYS.apiKey,
    SERVER_KEYS.policy,
    SERVER_KEYS.status,
  ]);
  const config = readServerConfig(data[SERVER_KEYS.config]);
  const rawConfig = data[SERVER_KEYS.config] as { url?: unknown } | undefined;
  return {
    enabled: config.enabled,
    // 연결이 꺼진 뒤에도 마지막으로 쓴 주소를 입력란에 남겨 둡니다.
    url: config.url || (typeof rawConfig?.url === "string" ? rawConfig.url : ""),
    hasKey: isPlausibleApiKey(data[SERVER_KEYS.apiKey]),
    policy: readStoredPolicy(data[SERVER_KEYS.policy]),
    status: readSyncStatus(data[SERVER_KEYS.status]),
  };
}

// 확장 안의 다른 부분(백그라운드)에 메시지를 보내고 응답을 기다립니다. 응답이 없으면 null.
function ask<T>(message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: T | undefined) => {
        void chrome.runtime.lastError;
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function formatTime(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString("ko-KR");
}

export function ServerCard() {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadServerState();
      setLoaded(next);
      return next;
    } catch {
      return EMPTY;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void refresh().then((next) => {
      if (alive) setUrl(next.url);
    });
    // 백그라운드가 동기화 결과를 저장하면 화면도 따라갑니다.
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== "local") return;
      if ([SERVER_KEYS.policy, SERVER_KEYS.status, SERVER_KEYS.config].some((name) => name in changes)) {
        void refresh();
      }
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch {
      // 저장소 변경 알림을 쓸 수 없는 환경에서는 버튼을 누를 때 갱신합니다.
    }
    return () => {
      alive = false;
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {
        // 위와 같음
      }
    };
  }, [refresh]);

  const connect = async () => {
    setMessage(null);
    const check = checkServerUrl(url);
    if (!check.ok || !check.origin) {
      setMessage({ ok: false, text: check.message ?? "주소가 올바르지 않습니다." });
      return;
    }
    const apiKey = key.trim();
    if (apiKey && !isPlausibleApiKey(apiKey)) {
      setMessage({ ok: false, text: "API 키 형식이 올바르지 않습니다. 공백 없이 16~256자의 영문·숫자·기호여야 합니다." });
      return;
    }
    if (!apiKey && !loaded.hasKey) {
      setMessage({ ok: false, text: "API 키를 입력해 주세요." });
      return;
    }

    setBusy(true);
    try {
      // 접근 권한 요청은 버튼을 누른 직후(사용자 동작 안)에서 해야 하므로 가장 먼저 합니다.
      const origin = `${check.origin}/*`;
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [origin] });
      } catch {
        granted = false;
      }
      if (!granted) {
        setMessage({ ok: false, text: "서버 접근을 허용하지 않아 연결하지 않았습니다." });
        return;
      }

      const keyToTest = apiKey || ((await chrome.storage.local.get(SERVER_KEYS.apiKey))[SERVER_KEYS.apiKey] as string);
      const probe = await ask<SyncStatus>({ type: POLICY_PROBE_MESSAGE, url: check.origin, key: keyToTest });
      if (!probe || probe.state !== "ok") {
        setMessage({ ok: false, text: `연결하지 않았습니다. ${probe?.message ?? "확장 프로그램 안에서 응답이 없습니다."}` });
        return;
      }

      const items: Record<string, unknown> = { [SERVER_KEYS.config]: { enabled: true, url: check.origin } };
      if (apiKey) items[SERVER_KEYS.apiKey] = apiKey;
      await chrome.storage.local.set(items);
      setKey("");
      const synced = await ask<SyncStatus>({ type: POLICY_SYNC_MESSAGE, force: true });
      setMessage({ ok: true, text: synced?.message ?? probe.message });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const status = await ask<SyncStatus>({ type: POLICY_SYNC_MESSAGE, force: true });
      setMessage(status ? { ok: status.state !== "error", text: status.message } : { ok: false, text: "응답이 없습니다." });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const origin = loaded.url ? checkServerUrl(loaded.url).origin : undefined;
      await chrome.storage.local.remove([SERVER_KEYS.config, SERVER_KEYS.apiKey, SERVER_KEYS.policy, SERVER_KEYS.status]);
      if (origin) {
        try {
          await chrome.permissions.remove({ origins: [`${origin}/*`] });
        } catch {
          // 권한 회수가 안 돼도 저장된 키·정책은 이미 지워졌습니다.
        }
      }
      setKey("");
      setMessage({ ok: true, text: "연결을 끊고 저장된 API 키와 조직 정책을 지웠습니다. 내장 정책으로 돌아갑니다." });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const { policy, status } = loaded;

  return (
    <div className="card" id="server-card">
      <h2>조직 정책 서버 (선택 · 기본 꺼짐)</h2>
      <p className="small">
        조직이 운영하는 정책 서버에서 <b>정책 표(범주별 조치)만 내려받아</b> 이 브라우저에서 판정합니다. 입력한 글·파일·감지
        결과는 서버로 <b>보내지 않습니다</b>. 보내는 것은 API 키와 정책 요청뿐입니다. 정책은 &quot;로컬 정책 적용&quot; 등
        위의 전송 보호 스위치가 켜져 있을 때 판정에 쓰이며, 연결하지 않으면 네트워크 요청이 전혀 없습니다.
      </p>

      <label className="field">
        서버 주소
        <input
          id="server-url"
          type="url"
          value={url}
          placeholder="https://pdp.example.com"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
      </label>
      <label className="field">
        API 키 {loaded.hasKey ? "(저장됨 · 바꾸려면 새로 입력)" : ""}
        <input
          id="server-key"
          type="password"
          value={key}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      </label>
      <p className="small">
        주소는 https만 쓸 수 있습니다(개발용 localhost·127.0.0.1은 http 가능). 키는 이 브라우저의 확장 저장소에만 저장되며,
        코드나 설정 파일에 적지 마세요. 브라우저 계정 동기화 대상이 아닙니다. 연결 버튼을 누르면 브라우저가 이 서버에 대한
        접근 허용을 물어봅니다.
      </p>

      <div className="row">
        <button id="server-connect" type="button" disabled={busy} onClick={() => void connect()}>
          {loaded.enabled ? "주소·키 바꿔 다시 연결" : "연결하고 정책 받기"}
        </button>
        {loaded.enabled && (
          <>
            <button id="server-sync" type="button" disabled={busy} onClick={() => void syncNow()}>
              지금 동기화
            </button>
            <button id="server-disconnect" type="button" disabled={busy} onClick={() => void disconnect()}>
              연결 끊기
            </button>
          </>
        )}
      </div>

      {message && (
        <p id="server-message" className={message.ok ? "small ok" : "small error"} role="status">
          {message.text}
        </p>
      )}

      <div id="server-status" className="small">
        {loaded.enabled ? (
          <>
            <p>
              상태: <b>연결됨</b> · {loaded.url}
              {status && (
                <>
                  {" "}
                  · 마지막 확인 {formatTime(status.at)} — {status.message}
                </>
              )}
            </p>
            {policy ? (
              <>
                <p>
                  적용 중인 조직 정책: <b>{policy.policyId} v{policy.version}</b> (받은 시각 {formatTime(policy.fetchedAt)})
                  {policy.description ? ` — ${policy.description}` : ""}
                </p>
                <ul className="plain">
                  {CATEGORIES.map((category) => (
                    <li key={category.id}>
                      {category.shortLabel}: {ACTION_TEXT[policy.categoryActions[category.id] ?? policy.unknownCategoryAction]}
                    </li>
                  ))}
                  <li>표에서 감지된 행 {policy.bulkRecordThreshold}건 이상: 첨부파일 차단 판정</li>
                </ul>
              </>
            ) : (
              <p>아직 정책을 받지 못했습니다. 내장 정책으로 판정합니다.</p>
            )}
          </>
        ) : (
          <p>상태: 연결 안 됨 (내장 정책 사용)</p>
        )}
      </div>
    </div>
  );
}
