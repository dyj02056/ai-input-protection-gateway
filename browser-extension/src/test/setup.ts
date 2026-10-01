import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  delete (globalThis as { chrome?: unknown }).chrome;
});
