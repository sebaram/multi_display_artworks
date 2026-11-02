import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LamPreview from "../../src/features/avatar/LamPreview";
import { setLocale } from "../../src/app/i18n";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ends loading without creating a renderer when no local LAM package is configured", async () => {
  setLocale("en");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ready: false, scope: "unavailable" })),
      ),
  );
  render(
    <LamPreview
      gaze={{ current: null }}
      appliedState={{ current: null }}
      summary={null}
      targetLabel="Forward"
    />,
  );
  expect(
    await screen.findByText(
      "No generated LAM avatar is available on this server.",
    ),
  ).toBeVisible();
  expect(screen.queryByTitle("LAM 3D renderer")).toBeNull();
});

it("accepts readiness only from its own frame and clears applied gaze on teardown", async () => {
  setLocale("en");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/status")
                ? { ready: true, scope: "local_research_only" }
                : {
                    sourceRevision: "fixture",
                    packageSha256: "fixture-hash",
                    gaussians: 20000,
                  },
            ),
          ),
      ),
  );
  const applied = { current: null as any },
    gaze = { current: { yaw: 0.1, pitch: 0.2 } as any };
  const view = render(
    <LamPreview
      gaze={gaze}
      appliedState={applied}
      summary={null}
      targetLabel="Forward"
    />,
  );
  const frame = (await screen.findByTitle(
    "LAM 3D renderer",
  )) as HTMLIFrameElement;
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: window,
        data: { type: "lam-ready" },
      }),
    ),
  );
  expect(screen.queryByText(/LAM avatar ready/)).toBeNull();
  vi.useFakeTimers();
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: frame.contentWindow!,
        data: { type: "lam-ready" },
      }),
    ),
  );
  act(() => vi.advanceTimersByTime(60));
  expect(applied.current).toMatchObject({
    format: "lam-arkit-v1",
    yaw: 0.1,
    pitch: 0.2,
    packageSha256: "fixture-hash",
  });
  view.unmount();
  expect(applied.current).toBeNull();
  expect(frame.isConnected).toBe(false);
});
