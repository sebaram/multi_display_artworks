import { test, expect } from "@playwright/test";
test("uploaded engine video uses public local-audio API and future layers remember it", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/engine-audio.html");
  await page.evaluate(async () => {
    const { createWallRenderer, normalizeWallLook } = await import(
      "/src/wall-engine/index.js"
    );
    const look = normalizeWallLook({
      showVideo: true,
      videoLayers: [{ id: "uploaded", assetId: "fixture" }],
    });
    const renderer = createWallRenderer({
      canvas: document.getElementById("audio-canvas"),
      config: look,
      assetResolver: () => "http://127.0.0.1:8766/video.mp4",
      onError: () => {},
    });
    (window as any).__audioRenderer = renderer;
    (window as any).__audioLook = look;
    document.getElementById("unmute")!.onclick = () => renderer.setMuted(false);
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const r = (window as any).__audioRenderer;
          r.render(1, { positionSeconds: 1, playing: true, rate: 1 });
          return r.getStats().media[0]?.ready;
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(
      () => (window as any).__audioRenderer.getStats().media[0].muted,
    ),
  ).toBe(true);
  await page.locator("#unmute").click();
  expect(
    await page.evaluate(
      () => (window as any).__audioRenderer.getStats().media[0].muted,
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const r = (window as any).__audioRenderer,
      look = (window as any).__audioLook;
    r.setConfig({
      ...look,
      state: {
        ...look.state,
        videoLayers: [
          ...look.state.videoLayers,
          { id: "new-layer", assetId: "fixture" },
        ],
      },
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__audioRenderer
          .getStats()
          .media.map((m: any) => m.muted),
      ),
    )
    .toEqual([false, false]);
  await page.evaluate(() => (window as any).__audioRenderer.dispose());
});
