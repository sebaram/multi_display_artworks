import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(
        [
          "/api",
          "/room/",
          "/socket.io",
          "/static",
          "/stream",
          "/visitor-capability",
          "/camera-data",
          "/get-cameras",
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
      "^/wall(?:\\?|$)": {
        target: backend,
        changeOrigin: false,
        bypass(request) {
          if (request.method !== "HEAD") return request.url;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
});
