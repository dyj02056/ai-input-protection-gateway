// 복원기가 실제 React 앱과 충돌하지 않는지 확인합니다. ChatGPT·Claude·Gemini 같은 사이트는 React류 프레임워크가
// 답변 글자를 계속 다시 쓰므로, 노드를 갈아 끼우면 "removeChild" 오류가 나거나 화면이 어긋납니다.
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetContentState } from "../test/contentEnv.ts";
import { startRestoring, stopRestoring } from "./restore.ts";
import { vault } from "./tokens.ts";

const PHONE = "010-1234-5678";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetContentState();
  vault.clear();
  vault.tokenFor("phone_number", PHONE); // [전화_1]
});
afterEach(() => {
  stopRestoring();
  vault.clear();
  vi.restoreAllMocks();
});

function Message({ text, extra }: { text: string; extra?: string }) {
  return (
    <div data-message-author-role="assistant">
      <p>
        {text}
        {extra ? <b>{extra}</b> : null}
      </p>
    </div>
  );
}

describe("실제 React 앱과 함께", () => {
  it("답변이 한 글자씩 다시 그려져도 오류 없이 끝에는 원래 값으로 보인다", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(<Message text="" />);
    startRestoring();

    let text = "";
    for (const chunk of ["안녕하세요 ", "[전", "화_", "1", "]님 ", "연락드리겠습니다"]) {
      text += chunk;
      await act(async () => {
        rerender(<Message text={text} />);
      });
      await tick();
    }

    expect(container.querySelector("p")!.textContent).toBe(`안녕하세요 ${PHONE}님 연락드리겠습니다`);
    expect(errors).not.toHaveBeenCalled();
  });

  it("복원된 글자가 있는 상태에서 React가 같은 글자를 다시 그려도, 다른 부분이 바뀌어도 어긋나지 않는다", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(<Message text="[전화_1]로 연락" />);
    startRestoring();
    await tick();
    expect(container.querySelector("p")!.firstChild!.nodeValue).toBe(`${PHONE}로 연락`);

    // 같은 글자로 다시 그림(React는 바뀌지 않았다고 보고 DOM을 건드리지 않는다)
    await act(async () => {
      rerender(<Message text="[전화_1]로 연락" />);
    });
    await tick();
    expect(container.querySelector("p")!.firstChild!.nodeValue).toBe(`${PHONE}로 연락`);

    // 글자가 바뀌면 React가 새 글자를 쓰고, 복원기가 다시 되돌린다. 형제 요소가 생겨도 문제없다.
    await act(async () => {
      rerender(<Message text="[전화_1]로 연락해 주세요" extra=" (급함)" />);
    });
    await tick();
    expect(container.querySelector("p")!.textContent).toBe(`${PHONE}로 연락해 주세요 (급함)`);
    expect(errors).not.toHaveBeenCalled();
  });

  it("복원한 글자가 들어 있는 요소를 React가 지워도(언마운트) 오류가 나지 않는다", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    function Chat() {
      const [show, setShow] = useState(true);
      return (
        <div>
          <button onClick={() => setShow(false)}>삭제</button>
          {show ? <Message text="[전화_1] 입니다" /> : null}
        </div>
      );
    }
    const { container } = render(<Chat />);
    startRestoring();
    await tick();
    expect(container.querySelector("p")!.textContent).toBe(`${PHONE} 입니다`);

    await act(async () => {
      container.querySelector("button")!.click();
    });
    await tick();
    expect(container.querySelector("p")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("React가 만든 텍스트 노드를 그대로 쓴다 (노드가 바뀌지 않았다)", async () => {
    const { container } = render(<Message text="[전화_1]" />);
    const before = container.querySelector("p")!.firstChild;
    startRestoring();
    await tick();
    expect(container.querySelector("p")!.firstChild).toBe(before);
  });
});
