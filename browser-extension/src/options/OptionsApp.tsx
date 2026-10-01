// 설정 화면: 바뀔 때마다 바로 chrome.storage.local에 저장합니다(저장 버튼 없음). 서버 전송 없음.
import { useEffect, useState } from "react";
import type { CategoryId } from "../shared/constants.ts";
import {
  coerceSettings,
  loadSettings,
  saveSettings,
  type BoolFeature,
  type Settings,
} from "../shared/settings.ts";
import { AuditTable } from "./AuditTable.tsx";
import { Toggle } from "./Toggle.tsx";
import { useHistory } from "./useHistory.ts";

const CATEGORY_ROWS: ReadonlyArray<readonly [CategoryId, string]> = [
  ["government_id", "주민등록번호 형식 — MASK"],
  ["phone_number", "전화번호 형식 — MASK"],
  ["email", "이메일 형식 — MASK"],
  ["api_key", "API 키/토큰 형식 — BLOCK 안내 (기본값은 자동 차단 없음)"],
];

const POSITION_ROWS = [
  ["top-right", "오른쪽 위"],
  ["bottom-left", "왼쪽 아래"],
] as const;

export function OptionsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { rows, clear } = useHistory();

  // 저장된 값을 읽기 전에는 폼을 그리지 않습니다. 기본값이 저장된 값을 덮어쓰는 일을 막기 위해서입니다.
  useEffect(() => {
    let alive = true;
    loadSettings()
      .catch(() => coerceSettings(undefined))
      .then((loaded) => {
        if (alive) setSettings(loaded);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) return null;

  const update = (next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  };
  const feature = (name: BoolFeature) => settings.features[name];
  const setFeature = (name: BoolFeature) => (checked: boolean) =>
    update({ ...settings, features: { ...settings.features, [name]: checked } });

  const handleClear = async () => {
    await clear();
    window.alert("로컬 기록을 삭제했습니다.");
  };

  return (
    <>
      <p>
        <a href="popup.html">← 팝업으로</a>
      </p>
      <h1>설정</h1>
      <p className="small">
        모든 설정은 브라우저 로컬에만 저장됩니다. 서버 전송·동기화 없음. 새로 설치한 확장은 감지
        안내와 실행 취소만 켜져 있고, 전송 차단·승인 확인·정책 적용·감사 기록은 모두 꺼져 있습니다.
      </p>

      <div className="card">
        <h2>탐지 항목 (4종)</h2>
        {CATEGORY_ROWS.map(([id, text]) => (
          <Toggle
            key={id}
            id={`c-${id}`}
            checked={settings.enabled[id]}
            onChange={(checked) =>
              update({ ...settings, enabled: { ...settings.enabled, [id]: checked } })
            }
          >
            {text}
          </Toggle>
        ))}
      </div>

      <div className="card">
        <h2>마스킹 방식</h2>
        <label>
          <input
            type="radio"
            name="mask"
            value="placeholder"
            checked={settings.maskStyle === "placeholder"}
            onChange={() => update({ ...settings, maskStyle: "placeholder" })}
          />{" "}
          자리표시자 ([전화번호] 등)
        </label>
        <label>
          <input type="radio" name="mask" value="token" disabled /> 세션 토큰 ([전화_1] + 응답 복원)
          — 다음 버전
        </label>
      </div>

      <div className="card">
        <h2>안내 표시와 실행 취소</h2>
        <Toggle
          id="f-persistentAlert"
          checked={feature("persistentAlert")}
          onChange={setFeature("persistentAlert")}
        >
          감지 안내 계속 표시 (8초 뒤 자동으로 사라지지 않음)
        </Toggle>
        <Toggle
          id="f-autoCloseWhenClean"
          checked={feature("autoCloseWhenClean")}
          onChange={setFeature("autoCloseWhenClean")}
        >
          감지된 값이 모두 없어지면 감지 안내 자동 닫기
        </Toggle>
        <Toggle id="f-undoButton" checked={feature("undoButton")} onChange={setFeature("undoButton")}>
          마스킹 결과에 &quot;실행 취소&quot; 버튼 표시
        </Toggle>
        <fieldset className="inline">
          <legend>안내창 위치</legend>
          {POSITION_ROWS.map(([value, text]) => (
            <label key={value}>
              <input
                type="radio"
                name="noticePosition"
                value={value}
                checked={settings.features.noticePosition === value}
                onChange={() =>
                  update({ ...settings, features: { ...settings.features, noticePosition: value } })
                }
              />{" "}
              {text}
            </label>
          ))}
        </fieldset>
        <p className="small">알림 결과·완료 안내는 8초 뒤에 사라지고, 감지 안내는 위 설정을 따릅니다.</p>
      </div>

      <div className="card">
        <h2>감사 기록 (기본 꺼짐)</h2>
        <p className="small">
          원문과 일치한 문자열은 저장하지 않습니다. 판정 이름·범주 ID·시각만 최근 20건을 브라우저
          로컬에 남깁니다.
        </p>
        <Toggle id="f-auditLog" checked={feature("auditLog")} onChange={setFeature("auditLog")}>
          감사 기록 남기기
        </Toggle>
        <AuditTable rows={rows} />
      </div>

      <div className="card">
        <h2>전송 보호 (모두 기본 꺼짐)</h2>
        <p className="small">
          이 확장은 기본적으로 자동으로 막지 않습니다. 아래 항목은 켜야 동작하며, 끄면 즉시 원래대로
          돌아갑니다.
        </p>
        <Toggle
          id="f-enforcePolicy"
          checked={feature("enforcePolicy")}
          onChange={setFeature("enforcePolicy")}
        >
          로컬 정책(정책 엔진) 적용 — 판정에 따라 안내 문구를 바꿉니다
        </Toggle>
        <Toggle id="f-blockSend" checked={feature("blockSend")} onChange={setFeature("blockSend")}>
          전송 차단 — 로컬 정책이 BLOCK인 값이 실린 채 보내기를 누르면 중단합니다
        </Toggle>
        <Toggle
          id="f-requireConfirm"
          checked={feature("requireConfirm")}
          onChange={setFeature("requireConfirm")}
        >
          승인 확인 단계 — 정책이 승인 검토 대상이면 보내기 전에 확인을 요구합니다
        </Toggle>
        <p className="small">
          &quot;전송 차단&quot;과 &quot;승인 확인 단계&quot;는 위의 &quot;로컬 정책 적용&quot;을 함께
          켜야 동작합니다.
        </p>
      </div>

      <div className="card">
        <h2>개인정보</h2>
        <p className="small">
          수집 항목 없음. 감사 기록은 원문 없이 범주·조치·시각만 최근 20건 로컬 표시. 아래 버튼으로
          전체 삭제.
        </p>
        <button id="clear" type="button" onClick={() => void handleClear()}>
          로컬 기록 전체 삭제
        </button>
      </div>
    </>
  );
}
