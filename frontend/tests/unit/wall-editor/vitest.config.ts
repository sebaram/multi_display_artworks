import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/wall-editor/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
});
