/** @jsxImportSource preact */
import { NOTICE_CSS } from "./styles.ts";

export interface NoticeViewProps {
  title: string;
  description: string;
  showMask: boolean;
  showUndo: boolean;
  onClose: () => void;
  onMask: () => void;
  onUndo: () => void;
}

// 상태 없이 props만으로 그리는 순수 컴포넌트입니다. 훅을 쓰지 않으므로 render()가 곧바로(동기) DOM을 바꿉니다.
// (입력 이벤트를 처리한 직후 같은 틱에서 DOM을 읽는 코드와 테스트가 있어 비동기 갱신이면 안 됩니다.)
export function Notice(props: NoticeViewProps) {
  const { title, description, showMask, showUndo, onClose, onMask, onUndo } = props;
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
      </div>
    </>
  );
}
