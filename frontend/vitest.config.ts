import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit/component tests only. Scoped to src/**/*.test.* so Playwright e2e specs
// (if any) are never picked up by vitest.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
