// 클래식 콘텐츠 스크립트용 진입점: manifest의 content_scripts가 content.js보다 먼저 읽는 detector.js가 됩니다.
// content.js와 docs 데모가 전역 AIInputGatewayDetector로 접근하므로 이름을 바꾸면 안 됩니다.
import { detector } from "../engine/detector.ts";

(globalThis as { AIInputGatewayDetector?: unknown }).AIInputGatewayDetector = detector;
