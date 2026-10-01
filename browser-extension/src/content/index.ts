// 콘텐츠 스크립트 진입점: manifest의 content_scripts가 detector.js·policy.js 다음에 읽는 content.js가 됩니다.
// 입력은 관찰만 합니다. 사용자가 알림 버튼을 누르기 전에는 내용을 수정하지 않습니다.
import { handleEditorEvent, refreshNoticePosition } from "./flow.ts";
import { installSendGuard } from "./sendGuard.ts";
import { watchSettings } from "./state.ts";

watchSettings(refreshNoticePosition);

document.addEventListener("input", handleEditorEvent, true);
document.addEventListener("paste", handleEditorEvent, true);

installSendGuard();
