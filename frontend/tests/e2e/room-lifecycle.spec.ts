import { test, expect } from "@playwright/test";
import { login, mutate } from "./helpers";
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

test("ten room entry/exit cycles release scenes, sockets, RAFs and WebGL contexts", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `Lifecycle ${Date.now()}`,
    description: "Owned lifecycle test",
  });
  await page.addInitScript(() => {
    const state = window as any;
    state.__contexts = new Set();
    state.__rafs = new Set();
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      const value = (context as any).apply(this, args);
      if (value && String(args[0]).startsWith("webgl"))
        state.__contexts.add(value);
      return value;
    } as any;
    const request = window.requestAnimationFrame.bind(window),
      cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        state.__rafs.delete(id);
        callback(time);
      });
      state.__rafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      state.__rafs.delete(id);
      cancel(id);
    };
  });
  let sockets = 0;
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/socket.io/")) return;
    sockets++;
    socket.on("close", () => sockets--);
  });
  try {
    await page.goto("/");
    for (let cycle = 0; cycle < 10; cycle++) {
      await page.getByRole("link", { name: room.name, exact: true }).click();
      await expect(page.locator("#voice-admin-btn")).toBeVisible({
        timeout: 20000,
      });
      await expect(page.locator("a-scene")).toHaveCount(1);
      await page.getByRole("link", { name: "← 전시 목록" }).click();
      await expect(
        page.locator("a-scene, #voice-ui, #minimap-canvas, [data-wall-layout]"),
      ).toHaveCount(0);
      await expect.poll(() => sockets).toBe(0);
      await expect
        .poll(() => page.evaluate(() => (window as any).__rafs.size))
        .toBe(0);
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...(window as any).__contexts].every(
              (context: WebGLRenderingContext) => context.isContextLost(),
            ),
          ),
        )
        .toBe(true);
    }
  } finally {
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});

test("saving an artwork preserves camera, microphone, scene and another artwork draft", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.addInitScript(() => {
    (window as any).__audioTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as any).__audioTracks.push(...stream.getAudioTracks());
      return stream;
    };
  });
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `Save lifecycle ${Date.now()}`,
    description: "Owned save regression",
  });
  const wall = await mutate(page, "/api/v1/admin/walls", "POST", {
    name: "Save wall",
    description: "Owned wall",
    room: room.id,
    position: "0 1.6 -3",
    rotation: "0 37 0",
    width: 6,
    height: 4,
    depth: 0.2,
  });
  const images = [];
  try {
    for (const name of ["Save A", "Save B"])
      images.push(
        await mutate(page, "/api/v1/admin/images", "POST", {
          name,
          description: "Owned image",
          wall: wall.id,
          position: "0 0 0",
          position_x: 0,
          position_y: 0,
          image_url: "http://127.0.0.1:8766/quadrants.png",
          width: 1,
          height: 1,
        }),
      );
    await page.goto(`/room?room_id=${room.id}`);
    await expect(page.locator("#voice-admin-btn")).toBeVisible({
      timeout: 20000,
    });
    await page.locator("#voice-admin-btn").click();
    await page.locator("#voice-btn").click();
    await expect(page.locator("#voice-btn")).toContainText("음소거");
    await page.evaluate(() => {
      (window as any).__scene = document.querySelector("a-scene");
      (window as any).__camera = document.querySelector("a-camera");
      (window as any).__camera.setAttribute("position", "1 1.6 5");
      (window as any).__voiceButton = document.querySelector("#voice-btn");
    });
    await page.getByRole("button", { name: /작품 목록/ }).click();
    await page.getByRole("button", { name: "▧ Save A 이미지" }).click();
    await page.getByLabel("가로 X", { exact: true }).fill("1.2");
    await page.getByRole("button", { name: "▧ Save B 이미지" }).click();
    await page.getByLabel("가로 X", { exact: true }).fill("2.3");
    await page.getByRole("button", { name: "작품 변경 저장" }).click();
    await expect(
      page.getByText("저장했습니다.", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).__scene === document.querySelector("a-scene") &&
          (window as any).__voiceButton ===
            document.querySelector("#voice-btn"),
      ),
    ).toBe(true);
    await expect(page.locator("#voice-btn")).toContainText("음소거");
    expect(
      await page.evaluate(() => (window as any).__audioTracks[0].readyState),
    ).toBe("live");
    expect(
      await page
        .locator("a-camera")
        .evaluate((camera: any) => camera.object3D.position.x),
    ).toBe(1);
    expect(
      await page
        .locator(`[data-element-id="${images[0].id}"]`)
        .evaluate((artwork: any) => artwork.object3D.position.x),
    ).toBe(1.2);
    await page.getByRole("button", { name: "▧ Save A 이미지" }).click();
    await expect(page.getByLabel("가로 X", { exact: true })).toHaveValue("1.2");
    await page.locator("#voice-admin-btn").click();
  } finally {
    for (const image of images)
      await mutate(page, `/api/v1/admin/images/${image.id}`, "DELETE");
    await mutate(page, `/api/v1/admin/walls/${wall.id}`, "DELETE");
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});
