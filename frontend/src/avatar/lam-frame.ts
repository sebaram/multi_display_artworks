import { GaussianSplatRenderer } from "gaussian-splat-renderer-for-lam/build/gaussian-splat-renderer-for-lam.module.js";
import { lamEyeWeights } from "./lam-gaze";

// This document isolates the SDK's singleton, worker and WebGL context from room scenes.
let expression: Record<string, number> = { ...lamEyeWeights(0, 0), jawOpen: 0 };
let neutral: Record<string, number> = {};
const send = (type: string, detail?: string) =>
  parent.postMessage({ type, detail }, location.origin);
const lifecycle = new AbortController();
let renderer: GaussianSplatRenderer | undefined;
let loaded = false,
  failed = false,
  disposed = false;
const fail = (reason: unknown) => {
  if (failed || disposed) return;
  failed = true;
  send("lam-error", reason instanceof Error ? reason.message : String(reason));
};
const ready = () => {
  if (loaded && renderer && !failed && !disposed) send("lam-ready");
};
window.addEventListener("unhandledrejection", (event) => fail(event.reason), {
  signal: lifecycle.signal,
});
window.addEventListener(
  "error",
  (event) => fail(event.error ?? event.message),
  { signal: lifecycle.signal },
);
window.addEventListener(
  "pagehide",
  () => {
    disposed = true;
    lifecycle.abort();
    renderer?.dispose();
  },
  { once: true },
);
window.addEventListener(
  "message",
  (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.type !== "lam-gaze"
    )
      return;
    const { yaw, pitch, yawDegrees, pitchDegrees, jawOpen } = event.data;
    expression = {
      ...neutral,
      ...lamEyeWeights(yaw, pitch, yawDegrees, pitchDegrees),
      jawOpen: Number.isFinite(jawOpen) ? Math.max(0, Math.min(1, jawOpen)) : 0,
    };
  },
  { signal: lifecycle.signal },
);
void GaussianSplatRenderer.getInstance(
  document.getElementById("avatar")!,
  "/api/v1/dev/lam-avatar/avatar.zip",
  {
    getExpressionData: () => expression,
    backgroundColor: "0xdce4e8",
    alpha: 1,
    loadProgress: (progress) => {
      if (progress >= 1) {
        loaded = true;
        ready();
      }
    },
  },
)
  .then((value) => {
    if (!value) {
      fail(new Error("LAM renderer initialization failed"));
      return;
    }
    renderer = value;
    if (disposed) {
      renderer.dispose();
      return;
    }
    const mesh = renderer.viewer?.skinModel,
      camera = renderer.getCamera?.();
    neutral = Object.fromEntries(
      Object.keys(mesh?.morphTargetDictionary ?? {}).map((key) => [key, 0]),
    );
    expression = { ...neutral, ...expression };
    // The SDK's default camera targets a full human; fit this head's local bounds.
    if (mesh && camera) {
      const points = mesh.geometry.attributes.position.array;
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < points.length; i++) {
        const axis = i % 3;
        min[axis] = Math.min(min[axis], points[i]);
        max[axis] = Math.max(max[axis], points[i]);
      }
      const center = min.map((low, axis) => (low + max[axis]) / 2);
      const distance = Math.max(max[0] - min[0], max[1] - min[1]) * 1.75;
      camera.position.set(center[0], center[1], center[2] + distance);
      camera.lookAt(center[0], center[1], center[2]);
      renderer.viewer?.controls?.target.set(center[0], center[1], center[2]);
      renderer.viewer?.controls?.update();
    }
    ready();
  })
  .catch(fail);
