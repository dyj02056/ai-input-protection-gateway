// 설정 화면: 바뀔 때마다 바로 chrome.storage.local에 저장합니다(저장 버튼 없음). 서버는 선택 사항이며 입력 내용은 보내지 않습니다.
import { useEffect, useState } from "react";
import { CATEGORIES } from "../shared/categories.ts";
import {
  ALLOWLIST_MAX_ENTRIES,
  ALLOWLIST_MAX_LENGTH,
  coerceSettings,
  loadSettings,
  parseAllowlistText,
  saveSettings,
  type BoolFeature,
  type Settings,
} from "../shared/settings.ts";
import { AuditTable } from "./AuditTable.tsx";
import { ServerCard } from "./ServerCard.tsx";
import { Toggle } from "./Toggle.tsx";
import { useHistory } from "./useHistory.ts";

// 항목은 shared/categories.ts에서 옵니다. BLOCK 판정 항목에는 "자동으로 막지 않는다"를 함께 적습니다.
const CATEGORY_ROWS = CATEGORIES.map((category) => {
  const note = category.defaultAction === "BLOCK" ? " 안내 (기본값은 자동 차단 없음)" : "";
  return [category.id, `${category.noticeLabel} — ${category.defaultAction}${note}`] as const;
});

const POSITION_ROWS = [
  ["top-right", "오른쪽 위"],
  ["bottom-left", "왼쪽 아래"],
] as const;

export function OptionsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [allowlistText, setAllowlistText] = useState("");
  const { rows, clear } = useHistory();

  // 저장된 값을 읽기 전에는 폼을 그리지 않습니다. 기본값이 저장된 값을 덮어쓰는 일을 막기 위해서입니다.
  useEffect(() => {
    let alive = true;
    loadSettings()
      .catch(() => coerceSettings(undefined))
      .then((loaded) => {
        if (!alive) return;
        setSettings(loaded);
        setAllowlistText(loaded.allowlist.join("\n"));
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

  // 입력란에서 벗어날 때 저장합니다. 비어 있거나 중복인 줄은 정리하고, 바뀐 경우에만 저장합니다.
  const commitAllowlist = () => {
    const list = parseAllowlistText(allowlistText);
    setAllowlistText(list.join("\n"));
    if (list.join("\n") !== settings.allowlist.join("\n")) {
      update({ ...settings, allowlist: list });
    }
  };

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
        모든 설정은 브라우저 로컬에만 저장됩니다. 기본값은 서버 연결 없음(아래 &quot;조직 정책 서버&quot;는 선택 사항). 새로 설치한 확장은 감지
        안내와 실행 취소만 켜져 있고, 전송 차단·승인 확인·정책 적용·감사 기록은 모두 꺼져 있습니다.
      </p>

      <div className="card">
        <h2>탐지 항목 ({CATEGORIES.length}종)</h2>
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
        <Toggle
          id="f-strictValidation"
          checked={feature("strictValidation")}
          onChange={setFeature("strictValidation")}
        >
          주민등록번호 엄격 검증 — 생년월일이 달력에 없는 값(월이 00 등)은 감지하지 않습니다. 체험용
          가짜 번호(000000-1000000)도 감지되지 않으니 체험할 때는 꺼 두세요.
        </Toggle>
      </div>

      <div className="card">
        <h2>무시할 값 (허용 목록)</h2>
        <p className="small">
          회사 대표번호처럼 매번 감지되어 번거로운 값을 한 줄에 하나씩 적으면 그 값은 감지하지
          않습니다. 공백·하이픈·대소문자는 구분하지 않습니다. 여기 적은 값은 <b>이 브라우저에 그대로
          저장</b>되며 어디로도 전송되지 않습니다. (검사한 입력 내용은 저장하지 않습니다.)
        </p>
        <textarea
          id="allowlist"
          rows={5}
          value={allowlistText}
          placeholder="02-123-4567"
          onChange={(event) => setAllowlistText(event.currentTarget.value)}
          onBlur={commitAllowlist}
        />
        <p className="small">
          최대 {ALLOWLIST_MAX_ENTRIES}줄, 한 줄에 {ALLOWLIST_MAX_LENGTH}자까지.
        </p>
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
          <input
            type="radio"
            name="mask"
            value="token"
            checked={settings.maskStyle === "token"}
            onChange={() => update({ ...settings, maskStyle: "token" })}
          />{" "}
          세션 토큰 ([전화_1]) — 같은 값은 같은 토큰으로 바꿔서, AI가 같은 사람임을 알 수 있게 합니다
        </label>
        <Toggle
          id="f-restoreTokens"
          checked={feature("restoreTokens")}
          onChange={setFeature("restoreTokens")}
        >
          AI 답변에 나온 토큰을 이 탭의 화면에서만 원래 값으로 복원해 표시 (세션 토큰 방식일 때)
        </Toggle>
        <p className="small">
          복원은 보여주기만 하며 어디로도 전송하지 않습니다. 대응표(토큰↔원래 값)는 이 탭의 메모리에만
          있고 새로고침하거나 탭을 닫으면 사라집니다. 다만 복원된 값은 화면에 있는 동안 해당 사이트의
          스크립트가 읽을 수 있는 상태가 됩니다. 내가 보낸 메시지 말풍선은 복원하지 않습니다(복원된
          값을 수정해 다시 보내면 원문이 전송되기 때문입니다). 원치 않으면 끄세요. 토큰이 그대로
          보입니다.
        </p>
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
        <h2>첨부파일 검사</h2>
        <p className="small">
          파일을 선택·드롭·붙여넣기하면 내용을 <b>이 브라우저 안에서만</b> 검사해 알려 드립니다. 파일은 어디로도
          전송·저장하지 않고, 결과에는 파일 이름과 감지된 항목의 종류·개수만 씁니다.
        </p>
        <Toggle
          id="f-inspectFiles"
          checked={feature("inspectFiles")}
          onChange={setFeature("inspectFiles")}
        >
          첨부파일 내용 검사하고 알리기
        </Toggle>
        <Toggle
          id="f-blockFileSend"
          checked={feature("blockFileSend")}
          onChange={setFeature("blockFileSend")}
        >
          첨부파일 전송 차단 — 개인정보·비밀 값이 감지됐거나 검사하지 못한 첨부파일이 있으면 보내기 첫 시도를
          중단합니다 (기본 꺼짐)
        </Toggle>
        <p className="small">
          &quot;첨부파일 전송 차단&quot;도 위의 &quot;로컬 정책 적용&quot;을 함께 켜야 동작하고, 첫 시도만 막으며 5초 안에 다시
          누르면 전송됩니다. 사이트가 선택·드롭 즉시 업로드를 시작할 수 있어 업로드 자체는 막지 못합니다.
        </p>
        <p className="small">
          검사하는 형식: 텍스트·CSV·TSV, Word(.docx), Excel(.xlsx, 숨김 시트 포함), 한글(.hwpx), 소스·설정 파일.
          표는 열 단위로 판정하고 100행 이상이면 대량으로 봅니다. 25MB를 넘거나, 암호가 걸렸거나, PDF·이미지·구형
          형식(.doc·.xls·.hwp)·압축 파일처럼 검사하지 못하는 파일은 &quot;검사하지 못했다&quot;고 알려 드립니다.
        </p>
      </div>

      <ServerCard />

      <div className="card">
        <h2>개인정보</h2>
        <p className="small">
          수집 항목 없음(조직 정책 서버에 연결한 경우에도 입력 내용·감사 기록은 보내지 않습니다). 감사 기록은 원문 없이 범주·조치·시각만 최근 20건 로컬 표시. 아래 버튼으로
          전체 삭제.
        </p>
        <button id="clear" type="button" onClick={() => void handleClear()}>
          로컬 기록 전체 삭제
        </button>
      </div>
    </>
  );
}
