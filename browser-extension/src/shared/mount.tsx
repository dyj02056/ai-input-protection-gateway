import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

export function mount(app: ReactNode): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root 요소를 찾을 수 없습니다.");
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
