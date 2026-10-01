import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { noticeHost, noticePart, openShadowRoots, requestedModes, resetContentState } from "../../test/contentEnv.ts";
import { state } from "../state.ts";
import { createNoticeController, type NoticeContent } from "./controller.ts";

const content = (patch: Partial<NoticeContent> = {}): NoticeContent => ({
  kind: "alert",
  title: "제목",
  description: "설명",
  showMask: false,
  showUndo: false,
  ...patch,
});

const makeHandlers = () => ({
  onClose: vi.fn(),
  onMask: vi.fn(),
  onUndo: vi.fn(),
  onHidden: vi.fn(),
});

let restoreShadow: () => void;
beforeAll(() => {
  restoreShadow = openShadowRoots();
});
afterAll(() => restoreShadow());
beforeEach(() => resetContentState());
afterEach(() => vi.useRealTimers());

describe("안내창 만들기와 갱신", () => {
  it("닫힌 shadow root로 만든다(사이트 CSS·스크립트가 내부를 건드리지 못함)", () => {
    createNoticeController(makeHandlers()).show(content(), 0);
    expect(requestedModes.at(-1)).toBe("closed");
  });

  it("제목·설명을 그리고 안내창은 하나만 유지한다", () => {
    const notice = createNoticeController(makeHandlers());
    notice.show(content({ title: "첫째" }), 0);
    notice.show(content({ title: "둘째", description: "바뀐 설명" }), 0);
    expect(document.querySelectorAll("[data-ai-input-gateway-notice]")).toHaveLength(1);
    expect(noticePart(".message strong")!.textContent).toBe("둘째");
    expect(noticePart(".message span")!.textContent).toBe("바뀐 설명");
    expect(notice.kind).toBe("alert");
  });

  it("버튼은 항상 있고, 필요 없을 때는 hidden으로 숨긴다", () => {
    const notice = createNoticeController(makeHandlers());
    notice.show(content(), 0);
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(true);
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(true);
    // 두 버튼이 모두 숨겨지면 빈 줄이 남지 않도록 묶음도 숨긴다.
    expect(noticePart(".actions")!.hidden).toBe(true);

    notice.show(content({ showMask: true }), 0);
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(false);
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(true);
    expect(noticePart(".actions")!.hidden).toBe(false);

    notice.show(content({ showUndo: true }), 0);
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(false);
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(true);
  });

  it("그리기는 동기적이다(이벤트 직후 같은 틱에서 DOM을 읽는 코드가 있다)", () => {
    createNoticeController(makeHandlers()).show(content({ title: "즉시" }), 0);
    expect(noticePart(".message strong")!.textContent).toBe("즉시");
  });

  it("바깥에서 안내창이 제거되면 다음에 새로 만든다", () => {
    const notice = createNoticeController(makeHandlers());
    notice.show(content({ title: "A" }), 0);
    noticeHost()!.remove();
    notice.show(content({ title: "B" }), 0);
    expect(noticePart(".message strong")!.textContent).toBe("B");
  });
});

describe("버튼 동작", () => {
  it("닫기·마스킹·실행 취소 버튼이 각각의 핸들러를 부른다", () => {
    const handlers = makeHandlers();
    createNoticeController(handlers).show(content({ showMask: true, showUndo: true }), 0);
    noticePart(".close-button")!.click();
    noticePart(".mask-button")!.click();
    noticePart(".undo-button")!.click();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onMask).toHaveBeenCalledTimes(1);
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it("hide()는 안내창을 없애고 onHidden을 부른다", () => {
    const handlers = makeHandlers();
    const notice = createNoticeController(handlers);
    notice.show(content(), 0);
    notice.hide();
    expect(noticeHost()).toBeNull();
    expect(notice.kind).toBe("");
    expect(handlers.onHidden).toHaveBeenCalledTimes(1);
  });
});

describe("자동으로 닫히는 시간", () => {
  it("0이면 계속 표시한다", () => {
    vi.useFakeTimers();
    createNoticeController(makeHandlers()).show(content(), 0);
    vi.advanceTimersByTime(60_000);
    expect(noticeHost()).not.toBeNull();
  });

  it("지정한 시간이 지나면 닫히고 onHidden을 부른다", () => {
    vi.useFakeTimers();
    const handlers = makeHandlers();
    createNoticeController(handlers).show(content({ kind: "result" }), 8000);
    vi.advanceTimersByTime(7999);
    expect(noticeHost()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeHost()).toBeNull();
    expect(handlers.onHidden).toHaveBeenCalledTimes(1);
  });

  it("다시 그리면 이전 타이머를 취소하고 새로 센다", () => {
    vi.useFakeTimers();
    const notice = createNoticeController(makeHandlers());
    notice.show(content({ kind: "result" }), 8000);
    vi.advanceTimersByTime(5000);
    notice.show(content({ kind: "alert" }), 0);
    vi.advanceTimersByTime(60_000);
    expect(noticeHost()).not.toBeNull();
  });
});

describe("안내창 위치", () => {
  it("기본은 오른쪽 위다", () => {
    createNoticeController(makeHandlers()).show(content(), 0);
    expect(noticeHost()!.dataset.position).toBe("top-right");
  });

  it("설정한 위치를 적용하고, 모르는 값은 오른쪽 위로 돌린다", () => {
    state.features.noticePosition = "bottom-left";
    const notice = createNoticeController(makeHandlers());
    notice.show(content(), 0);
    expect(noticeHost()!.dataset.position).toBe("bottom-left");
    notice.hide();

    state.features.noticePosition = "somewhere";
    notice.show(content(), 0);
    expect(noticeHost()!.dataset.position).toBe("top-right");
  });

  it("안내창을 닫은 뒤 새로 만든 안내창에도 위치가 적용된다 (1.1.0의 결함 회귀 방지)", () => {
    state.features.noticePosition = "bottom-left";
    const notice = createNoticeController(makeHandlers());
    notice.show(content(), 0);
    notice.hide();
    notice.show(content(), 0);
    expect(noticeHost()!.dataset.position).toBe("bottom-left");
  });

  it("표시 중에 설정이 바뀌면 refreshPosition()으로 바로 반영한다", () => {
    const notice = createNoticeController(makeHandlers());
    notice.show(content(), 0);
    expect(noticeHost()!.dataset.position).toBe("top-right");
    state.features.noticePosition = "bottom-left";
    notice.refreshPosition();
    expect(noticeHost()!.dataset.position).toBe("bottom-left");
  });

  it("안내창이 없을 때 refreshPosition()은 아무 일도 하지 않는다", () => {
    expect(() => createNoticeController(makeHandlers()).refreshPosition()).not.toThrow();
  });
});
