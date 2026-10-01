// 알림창은 닫힌 shadow root 안에 그리므로 사이트의 CSS와 서로 영향을 주지 않습니다.
// 안내창 위치는 설정값을 host의 data-position으로 옮겨 아래 :host 규칙이 처리하게 합니다.
export const NOTICE_CSS = `
      :host {
        all: initial;
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        display: block;
        width: max-content;
        max-width: min(360px, calc(100vw - 24px));
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      :host([data-position="bottom-left"]) {
        top: auto;
        right: auto;
        bottom: 12px;
        left: 12px;
      }

      .notice {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border: 1px solid #c7d2e1;
        border-radius: 10px;
        background: #ffffff;
        color: #172033;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.16);
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .message {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding-right: 18px;
      }

      .notice strong {
        font-size: 14px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .actions[hidden] {
        display: none;
      }

      .mask-button,
      .undo-button {
        border: 0;
        border-radius: 6px;
        padding: 7px 10px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .mask-button {
        background: #155eef;
        color: #ffffff;
      }

      .mask-button:hover {
        background: #004eeb;
      }

      .undo-button {
        background: #eef2f9;
        color: #22304a;
        border: 1px solid #c7d2e1;
      }

      .undo-button:hover {
        background: #e2e9f5;
      }

      .close-button {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #5a6b8c;
        font: inherit;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
      }

      .close-button:hover {
        background: #eef2f9;
        color: #22304a;
      }

      .mask-button:focus-visible,
      .undo-button:focus-visible,
      .close-button:focus-visible {
        outline: 3px solid #94b7ff;
        outline-offset: 2px;
      }

      [hidden] {
        display: none;
      }
    `;
