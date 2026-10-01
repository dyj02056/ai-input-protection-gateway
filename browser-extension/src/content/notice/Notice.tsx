/** @jsxImportSource preact */
import { APPROVAL_NOTE_MAX, APPROVAL_PURPOSES } from "../../shared/approval.ts";
import { NOTICE_CSS } from "./styles.ts";

// 승인 요청 영역에 보여 줄 내용입니다. canRequest이면 업무 목적 선택·사유 입력·요청 버튼을 함께 그립니다.
export interface NoticeApproval {
  text: string;
  canRequest: boolean;
}

export interface NoticeViewProps {
  title: string;
  description: string;
  showMask: boolean;
  showUndo: boolean;
  approval?: NoticeApproval | null;
  onClose: () => void;
  onMask: () => void;
  onUndo: () => void;
  onApprovalRequest?: (purpose: string, note: string) => void;
}

// 사유 입력란에서 누른 키가 사이트의 단축키로 새어 나가지 않게 합니다.
const keepKeys = (event: Event): void => event.stopPropagation();

// 상태 없이 props만으로 그리는 순수 컴포넌트입니다. 훅을 쓰지 않으므로 render()가 곧바로(동기) DOM을 바꿉니다.
// (입력 이벤트를 처리한 직후 같은 틱에서 DOM을 읽는 코드와 테스트가 있어 비동기 갱신이면 안 됩니다.)
export function Notice(props: NoticeViewProps) {
  const { title, description, showMask, showUndo, approval, onClose, onMask, onUndo, onApprovalRequest } = props;
  return (
    <>
      <style>{NOTICE_CSS}</style>
      <div class="notice" role="region" aria-label="로컬 입력 검사 안내">
        <button
          type="button"
          class="close-button"
          title="안내 닫기"
          aria-label="안내 닫기"
          onClick={onClose}
        >
          ×
        </button>
        <div class="message" role="status" aria-live="polite">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        {/* 두 버튼이 모두 숨겨지면 빈 줄이 남지 않게 합니다. */}
        <div class="actions" hidden={!showMask && !showUndo}>
          <button type="button" class="mask-button" hidden={!showMask} onClick={onMask}>
            감지 항목 마스킹
          </button>
          <button type="button" class="undo-button" hidden={!showUndo} onClick={onUndo}>
            실행 취소
          </button>
        </div>
        {approval && (
          <div class="approval" role="group" aria-label="승인 요청">
            <div class="approval-text" role="status" aria-live="polite">
              {approval.text}
            </div>
            {approval.canRequest && (
              <div class="approval-form">
                <select class="approval-purpose" aria-label="업무 목적" onKeyDown={keepKeys}>
                  {APPROVAL_PURPOSES.map((purpose) => (
                    <option value={purpose.id}>{purpose.label}</option>
                  ))}
                </select>
                <input
                  class="approval-note"
                  type="text"
                  maxLength={APPROVAL_NOTE_MAX}
                  placeholder="사유(선택) — 개인정보는 쓰지 마세요"
                  aria-label="승인 요청 사유"
                  autocomplete="off"
                  onKeyDown={keepKeys}
                  onKeyUp={keepKeys}
                  onKeyPress={keepKeys}
                />
                <button
                  type="button"
                  class="approval-button"
                  onClick={(event) => {
                    const form = (event.currentTarget as HTMLElement).closest(".approval-form");
                    const purpose = form?.querySelector<HTMLSelectElement>(".approval-purpose")?.value ?? "other";
                    const note = form?.querySelector<HTMLInputElement>(".approval-note")?.value ?? "";
                    onApprovalRequest?.(purpose, note);
                  }}
                >
                  승인 요청 보내기
                </button>
                <span class="approval-hint">
                  보내는 것: 감지된 항목 종류·업무 목적·위 사유. 입력한 글은 보내지 않습니다.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
