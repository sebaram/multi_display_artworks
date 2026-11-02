import { afterEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ getInstance: vi.fn() }));
vi.mock(
  "gaussian-splat-renderer-for-lam/build/gaussian-splat-renderer-for-lam.module.js",
  () => ({ GaussianSplatRenderer: sdk }),
);
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.resetModules();
});

it("waits for complete splat loading before reporting ready", async () => {
  const dispose = vi.fn();
  sdk.getInstance.mockResolvedValue({ dispose });
  document.body.innerHTML = '<div id="avatar"></div>';
  const send = vi.spyOn(window.parent, "postMessage");
  await import("../../src/avatar/lam-frame");
  await Promise.resolve();
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "lam-ready" }),
    expect.anything(),
  );
  sdk.getInstance.mock.calls.at(-1)![2].loadProgress(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "lam-ready" }),
    location.origin,
  );
});

it("reports a swallowed SDK initialization failure instead of false readiness", async () => {
  sdk.getInstance.mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="avatar"></div>';
  const send = vi.spyOn(window.parent, "postMessage");
  await import("../../src/avatar/lam-frame");
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "lam-error" }),
    location.origin,
  );
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "lam-ready" }),
    expect.anything(),
  );
});
