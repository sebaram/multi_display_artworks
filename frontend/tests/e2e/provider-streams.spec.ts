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

test("AI preview moves to rotated destination, cancel restores and durable apply matches; effects relay", async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await login(page);
  const llm = (
    await (await page.request.get("/api/v1/admin/llm-configs")).json()
  ).items[0];
  const llmBefore = {
    provider: llm.provider,
    api_base: llm.api_base,
    model: llm.model,
    is_active: llm.is_active,
  };
  await mutate(page, `/api/v1/admin/llm-configs/${llm.id}`, "PATCH", {
    provider: "openai",
    api_base: "http://127.0.0.1:8766/v1",
    model: "synthetic",
    is_active: true,
  });
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `AI acceptance ${Date.now()}`,
    description: "Owned provider acceptance",
  });
  const walls: any[] = [],
    images: any[] = [];
  try {
    for (const [name, rotation] of [
      ["A", "0 0 0"],
      ["B", "0 37 0"],
    ])
      walls.push(
        await mutate(page, "/api/v1/admin/walls", "POST", {
          name,
          description: "Owned rotated wall",
          room: room.id,
          position: "0 1.6 -3",
          rotation,
          width: 6,
          height: 4,
          depth: 0.2,
        }),
      );
    for (const name of ["AI image 1", "AI image 2"])
      images.push(
        await mutate(page, "/api/v1/admin/images", "POST", {
          name,
          description: "Owned image",
          wall: walls[0].id,
          position: "0.4 0.2 0",
          position_x: 0.4,
          position_y: 0.2,
          width: 0.7,
          height: 0.7,
          image_url: "http://127.0.0.1:8766/quadrants.png",
        }),
      );
    await page.goto(`/room?room_id=${room.id}`);
    await expect(page.locator("[data-element-id]")).toHaveCount(2);
    await page.evaluate(
      () => ((window as any).__sceneBefore = document.querySelector("a-scene")),
    );
    await page.getByRole("button", { name: "AI 큐레이션" }).click();
    await page
      .getByLabel("작품 배치나 공간 효과 요청")
      .fill("Move both works across walls");
    await page.getByRole("button", { name: "배치 제안", exact: true }).click();
    await expect(page.getByText("Synthetic local layout")).toBeVisible();
    const moved = page.locator(`[data-element-id="${images[1].id}"]`);
    await expect
      .poll(() =>
        moved.evaluate((el) => el.parentElement?.getAttribute("data-wall-id")),
      )
      .toBe(walls[1].id);
    const world = await moved.evaluate((el: any) => {
      el.object3D.updateWorldMatrix(true, false);
      const position = new (window as any).AFRAME.THREE.Vector3();
      el.object3D.getWorldPosition(position);
      return position.toArray();
    });
    expect(
      (
        await (
          await page.request.get(`/api/v1/elements/image/${images[1].id}`)
        ).json()
      ).wall,
    ).toBe(walls[0].id);
    await page.getByRole("button", { name: "AI 패널 닫기" }).click();
    await expect
      .poll(() =>
        moved.evaluate((el) => el.parentElement?.getAttribute("data-wall-id")),
      )
      .toBe(walls[0].id);
    await page.getByRole("button", { name: "AI 큐레이션" }).click();
    await page
      .getByLabel("작품 배치나 공간 효과 요청")
      .fill("Move both works across walls");
    await page.getByRole("button", { name: "배치 제안", exact: true }).click();
    await page.getByRole("button", { name: "제안한 배치 저장·적용" }).click();
    await expect(page.getByText("배치를 저장했습니다.")).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`/api/v1/elements/image/${images[1].id}`)
        ).json()
      ).wall,
    ).toBe(walls[1].id);
    const applied = await moved.evaluate((el: any) => {
      el.object3D.updateWorldMatrix(true, false);
      return el.object3D
        .getWorldPosition(new (window as any).AFRAME.THREE.Vector3())
        .toArray();
    });
    applied.forEach((value: number, index: number) =>
      expect(value).toBeCloseTo(world[index], 5),
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).__sceneBefore === document.querySelector("a-scene"),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "효과 만들기" }).click();
    await expect(page.locator("#llm-ambient-light")).toHaveCount(1);
    await page.getByRole("button", { name: "효과 해제", exact: true }).click();
    await expect(page.locator("#llm-ambient-light")).toHaveCount(0);
  } finally {
    await mutate(
      page,
      `/api/v1/admin/llm-configs/${llm.id}`,
      "PATCH",
      llmBefore,
    );
    for (const image of images)
      await mutate(page, `/api/v1/admin/images/${image.id}`, "DELETE");
    for (const effect of (
      await (await page.request.get("/api/v1/admin/effects?limit=200")).json()
    ).items.filter((effect: any) => effect.room === room.id))
      await mutate(page, `/api/v1/admin/effects/${effect.id}`, "DELETE");
    for (const wall of walls)
      await mutate(page, `/api/v1/admin/walls/${wall.id}`, "DELETE");
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});

test("Streams UI converts real RTSP to playable HLS", async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await login(page);
  const id = `rtsp-ui-${Date.now()}`;
  try {
    await page.goto("/tools/streams");
    await page.getByLabel("스트림 ID", { exact: true }).fill(id);
    await page
      .getByLabel("RTSP URL", { exact: true })
      .fill("rtsp://127.0.0.1:8554/fixture");
    await page.getByRole("button", { name: "RTSP 연결 시작" }).click();
    await expect(page.getByText("RTSP 변환을 시작했습니다.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/stream/list")).json()).find(
            (stream: any) => stream.stream_id === id,
          )?.has_playlist,
        { timeout: 30000 },
      )
      .toBe(true);
    const player = page.getByLabel("HLS 스트림 재생 확인");
    await expect
      .poll(
        () => player.evaluate((video: HTMLVideoElement) => video.readyState),
        { timeout: 20000 },
      )
      .toBeGreaterThanOrEqual(2);
    await player.evaluate((video: HTMLVideoElement) => video.play());
    await expect
      .poll(
        () => player.evaluate((video: HTMLVideoElement) => video.currentTime),
        { timeout: 20000 },
      )
      .toBeGreaterThan(1);
    expect(
      await player.evaluate((video: HTMLVideoElement) => video.videoWidth),
    ).toBeGreaterThan(0);
  } finally {
    await mutate(page, `/stream/stop/${id}`, "POST");
  }
});

test.describe("synthetic phone camera", () => {
  test("actual MediaRecorder uploads produce playable backend HLS and clean tracks", async ({
    page,
  }) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(10000);
    await login(page);
    const id = `phone-ui-${Date.now()}`;
    try {
      await page.goto("/tools/streams");
      await page.getByLabel("스트림 ID", { exact: true }).fill(id);
      await page.getByRole("button", { name: "카메라 전송 시작" }).click();
      await expect(
        page.getByRole("button", { name: "카메라 전송 종료" }),
      ).toBeVisible();
      await page
        .locator("video")
        .first()
        .evaluate(
          (video: HTMLVideoElement) =>
            ((window as any).__phoneTracks = (
              video.srcObject as MediaStream
            ).getTracks()),
        );
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/stream/list")).json()).find(
              (stream: any) => stream.stream_id === id,
            )?.has_playlist,
          { timeout: 45000 },
        )
        .toBe(true);
      await page.getByRole("button", { name: "새로고침", exact: true }).click();
      await page
        .locator(".stream-item")
        .filter({ hasText: id })
        .getByRole("button", { name: "재생 확인" })
        .click();
      const player = page.getByLabel("HLS 스트림 재생 확인");
      await expect
        .poll(
          () => player.evaluate((video: HTMLVideoElement) => video.readyState),
          { timeout: 20000 },
        )
        .toBeGreaterThanOrEqual(2);
      await player.evaluate((video: HTMLVideoElement) => video.play());
      await expect
        .poll(
          () => player.evaluate((video: HTMLVideoElement) => video.currentTime),
          { timeout: 20000 },
        )
        .toBeGreaterThan(1);
      await page.getByRole("button", { name: "카메라 전송 종료" }).click();
      expect(
        await page.evaluate(() =>
          (window as any).__phoneTracks.every(
            (track: MediaStreamTrack) => track.readyState === "ended",
          ),
        ),
      ).toBe(true);
    } finally {
      await mutate(page, `/stream/stop/${id}`, "POST");
    }
  });
});
