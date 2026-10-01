// 클래식 콘텐츠 스크립트용 진입점: manifest의 content_scripts가 content.js보다 먼저 읽는 policy.js가 됩니다.
// content.js가 전역 AIInputGatewayPolicy로 접근하므로 이름을 바꾸면 안 됩니다.
import { policy } from "../engine/policy.ts";

(globalThis as { AIInputGatewayPolicy?: unknown }).AIInputGatewayPolicy = policy;
