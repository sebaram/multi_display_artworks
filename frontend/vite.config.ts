import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      [
        "/api",
        "/room/",
        "/socket.io",
        "/static",
        "/stream",
        "/visitor-capability",
        "/marker",
        "/ar-companion/status",
        "/llm",
        "/whisper",
        "/ar/",
        "/gesture-mark/api",
        "/gesture-mark/events",
        "/gesture-mark/stream",
      ].map((path) => [
        path,
        { target: backend, changeOrigin: false, ws: true },
      ]),
    ),
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
});
