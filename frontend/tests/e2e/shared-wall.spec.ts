import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { login } from "./helpers";

async function mutation(
  page: Page,
  path: string,
  method: string,
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrf_token } = await (await fetch("/api/v1/auth/csrf")).json();
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf_token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok)
        throw Error(`${response.status} ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

function observe(page: Page) {
  const events: { name: string; data: any }[] = [];
  const packets: {
    at: number;
    transport: string;
    direction: string;
    name: string;
    data: any;
  }[] = [];
  function packet(payload: string, transport: string, direction = "received") {
    for (const part of payload.split("\x1e")) {
      const match = /^42\d*(\[.*)$/s.exec(part);
      if (!match) continue;
      const [name, data] = JSON.parse(match[1]);
      if (name.startsWith("wall."))
        packets.push({ at: Date.now(), transport, direction, name, data });
      if (direction === "received") events.push({ name, data });
    }
  }
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) =>
      packet(payload.toString(), "websocket"),
    );
    socket.on("framesent", ({ payload }) =>
      packet(payload.toString(), "websocket", "sent"),
    );
  });
  page.on("request", (request) => {
    if (
      request.url().includes("/socket.io/") &&
      request.url().includes("transport=polling") &&
      request.method() === "POST"
    )
      packet(request.postData() || "", "polling", "sent");
  });
  page.on("response", async (response) => {
    if (
      response.url().includes("/socket.io/") &&
      response.url().includes("transport=polling")
    ) {
      try {
        packet(await response.text(), "polling");
      } catch {}
    }
  });
  return {
    events,
    packets,
    latest: (name: string, wallId: string) =>
      events
        .filter((event) => event.name === name && event.data.wall_id === wallId)
        .at(-1)?.data,
  };
}

async function instrumentMedia(page: Page) {
  await page.addInitScript(() => {
    (window as any).__videos = [];
    const original = Document.prototype.createElement;
    Document.prototype.createElement = function (...args: any[]) {
      const element = (original as any).apply(this, args);
      if (String(args[0]).toLowerCase() === "video")
        (window as any).__videos.push(element);
      return element;
    } as any;
  });
}

async function media(page: Page) {
  return page.evaluate(() => {
    const video = (window as any).__videos.find(
      (v: HTMLVideoElement) =>
        v.src.includes("/wall-assets/") && !!v.getAttribute("src"),
    );
    return video
      ? {
          time: video.currentTime,
          paused: video.paused,
          ready: video.readyState,
          sampledAt: Date.now(),
        }
      : null;
  });
}

test("real shared pointer, uploaded MP4 controls, late join, reconnect, isolation and live removal", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(10000);
  await login(page);
  // Recover only this test's temporary records after an interrupted prior run.
  for (const old of (
    await (await page.request.get("/api/v1/admin/rooms?limit=200")).json()
  ).items.filter((room: any) => /^Shared acceptance \d+$/.test(room.name))) {
    for (const value of old.walls || []) {
      const wall = { id: typeof value === "string" ? value : value.id };
      const applied = await (
        await page.request.get(`/api/v1/walls/${wall.id}/design`)
      ).json();
      if (applied)
        await mutation(
          page,
          `/api/v1/walls/${wall.id}/design?expected_revision=${applied.revision}`,
          "DELETE",
        );
      await mutation(page, `/api/v1/admin/walls/${wall.id}`, "DELETE");
    }
    await mutation(page, `/api/v1/admin/rooms/${old.id}`, "DELETE");
  }
  for (const old of (
    await (await page.request.get("/api/v1/wall-presets")).json()
  ).filter((preset: any) => /^Shared \d+$/.test(preset.name)))
    await mutation(
      page,
      `/api/v1/wall-presets/${old.id}?expected_revision=${old.revision}`,
      "DELETE",
    );
  for (const old of (
    await (await page.request.get("/api/v1/wall-assets")).json()
  ).filter((asset: any) => asset.name === "shared-fixture.mp4"))
    await mutation(page, `/api/v1/wall-assets/${old.id}`, "DELETE");
  const suffix = Date.now();
  const room = await mutation(page, "/api/v1/admin/rooms", "POST", {
    name: `Shared acceptance ${suffix}`,
    description: "Owned temporary acceptance room",
  });
  const wall = await mutation(page, "/api/v1/admin/walls", "POST", {
    name: "Shared MP4",
    description: "Owned temporary wall",
    room: room.id,
    position: "0 1.6 -3",
    rotation: "0 0 0",
    width: 6,
    height: 3.375,
    depth: 0.2,
    video_url: "http://127.0.0.1:8766/video.mp4",
  });
  const csrf = await page.request
    .get("/api/v1/auth/csrf")
    .then((r) => r.json());
  const upload = await page.request.post("/api/v1/wall-assets", {
    headers: {
      Origin: "http://127.0.0.1:5173",
      "X-CSRF-Token": csrf.csrf_token,
    },
    multipart: {
      file: {
        name: "shared-fixture.mp4",
        mimeType: "video/mp4",
        buffer: await readFile("tests/fixtures/media/video.mp4"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  const config = (
    await (await page.request.get("/wall-presets/builtin-0.json")).json()
  ).config;
  Object.assign(config.state, {
    paused: true,
    offset: 1,
    interactive: true,
    showVideo: true,
    branding: false,
    videoLayers: [
      {
        id: "shared-video",
        assetId: asset.id,
        x: 50,
        y: 50,
        width: 50,
        enabled: true,
        sourceAspect: 16 / 9,
        screens: {},
      },
    ],
  });
  const preset = await mutation(page, "/api/v1/wall-presets", "POST", {
    name: `Shared ${suffix}`,
    config,
  });
  const guestContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const guest = await guestContext.newPage(),
    other = await otherContext.newPage();
  const adminEvents = observe(page),
    guestEvents = observe(guest),
    otherEvents = observe(other);
  await instrumentMedia(page);
  await instrumentMedia(guest);
  let binding: any;
  try {
    await page.goto(`/room?room_id=${room.id}`);
    await guest.goto(`/room?room_id=${room.id}`);
    await other.goto("/room?room_id=000000000000000000000002");
    await expect(page.locator("a-video")).toHaveCount(1);
    binding = await mutation(page, `/api/v1/walls/${wall.id}/design`, "PUT", {
      preset_id: preset.id,
      expected_revision: 0,
    });
    await expect(page.locator(".wall-surface")).toHaveCount(1);
    await expect(guest.locator(".wall-surface")).toHaveCount(1);
    await expect(page.locator("a-video")).toHaveCount(0);
    await expect.poll(() => media(guest)).toMatchObject({ paused: true });
    await expect.poll(async () => (await media(guest))?.time).toBeCloseTo(1, 1);
    await expect(
      guest.getByRole("button", { name: "Shared MP4 공유 일시정지" }),
    ).toHaveCount(0);
    await page.getByText("Shared MP4 공유 재생 제어", { exact: true }).click();
    await page.getByLabel("Shared MP4 이동 시간 (초)").fill("2");
    await page
      .getByRole("button", { name: "Shared MP4 공유 위치 이동", exact: true })
      .click();
    await expect.poll(async () => (await media(guest))?.time).toBeCloseTo(2, 1);
    await page
      .getByRole("button", { name: "Shared MP4 공유 재생", exact: true })
      .click();
    await expect
      .poll(async () => (await media(guest))?.time)
      .toBeGreaterThan(2.3);
    await expect
      .poll(
        async () => {
          const [a, b] = await Promise.all([media(page), media(guest)]);
          if (!a || !b) return 999;
          const delta = a.time + (b.sampledAt - a.sampledAt) / 1000 - b.time;
          return Math.abs(((delta + 9) % 6) - 3); // six-second fixture, compared at one sample time
        },
        { timeout: 15000 },
      )
      .toBeLessThan(0.5);
    await page
      .getByRole("button", { name: "Shared MP4 공유 일시정지", exact: true })
      .click();
    await expect.poll(() => media(guest)).toMatchObject({ paused: true });
    const paused = (await media(guest))!.time;
    await guest.waitForTimeout(700);
    expect((await media(guest))!.time).toBeCloseTo(paused, 2);

    // The actual surface input handler emits through the room's real visitor socket.
    const beforePointer = await guest
      .locator(`#design-${wall.id}`)
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await page.locator(".wall-surface").evaluate((surface) =>
      surface.dispatchEvent(
        new CustomEvent("mousemove", {
          detail: { intersection: { uv: { x: 0.8, y: 0.7 } } },
        }),
      ),
    );
    await expect
      .poll(
        () => guestEvents.latest("wall.interaction_state", wall.id)?.pointer,
      )
      .toEqual({ x: 0.30000000000000004, y: -0.19999999999999996 });
    const accepted = guestEvents.latest("wall.interaction_state", wall.id);
    const canonical = {
      runtime_id: accepted.runtime_id,
      sequence: accepted.sequence,
      binding_revision: accepted.binding_revision,
      pointer: accepted.pointer,
    };
    await expect
      .poll(() => ({
        admin: adminEvents.latest("wall.interaction_state", wall.id),
        guest: guestEvents.latest("wall.interaction_state", wall.id),
      }))
      .toMatchObject({ admin: canonical, guest: canonical });
    await expect
      .poll(() =>
        guest
          .locator(`#design-${wall.id}`)
          .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
      )
      .not.toBe(beforePointer);
    expect(
      otherEvents.events.some((event) => event.data?.wall_id === wall.id),
    ).toBe(false);

    // New page and a real offline/reconnect both recover the persisted paused position.
    await guest.reload();
    await expect
      .poll(async () => (await media(guest))?.ready, { timeout: 20000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => (await media(guest))?.time, { timeout: 20000 })
      .toBeCloseTo(paused, 1);
    const snapshotCount = guestEvents.events.filter(
      (event) => event.name === "wall.snapshot",
    ).length;
    await guestContext.setOffline(true);
    await guest.waitForTimeout(700);
    await guestContext.setOffline(false);
    await expect
      .poll(
        () =>
          guestEvents.events.filter((event) => event.name === "wall.snapshot")
            .length,
        { timeout: 20000 },
      )
      .toBeGreaterThan(snapshotCount);
    await expect
      .poll(async () => (await media(guest))?.time)
      .toBeCloseTo(paused, 1);

    config.seed = 17;
    binding = await mutation(page, `/api/v1/walls/${wall.id}/design`, "PUT", {
      config,
      expected_revision: binding.revision,
    });
    await expect
      .poll(() => guestEvents.latest("wall.design_applied", wall.id)?.seed)
      .toBe(17);
    await expect(page.locator(".wall-surface")).toHaveCount(1);
    await page.locator(".wall-surface").evaluate((surface) =>
      surface.dispatchEvent(
        new CustomEvent("mousemove", {
          detail: { intersection: { uv: { x: 0.2, y: 0.1 } } },
        }),
      ),
    );
    await expect
      .poll(
        () =>
          guestEvents.latest("wall.interaction_state", wall.id)
            ?.binding_revision,
      )
      .toBe(binding.revision);
    await expect
      .poll(
        () => guestEvents.latest("wall.interaction_state", wall.id)?.pointer,
      )
      .toEqual({ x: -0.3, y: 0.4 });
    await mutation(
      page,
      `/api/v1/walls/${wall.id}/design?expected_revision=${binding.revision}`,
      "DELETE",
    );
    binding = null;
    await expect(guest.locator(".wall-surface")).toHaveCount(0);
    await expect(guest.locator("a-video")).toHaveCount(1);
    await expect
      .poll(() =>
        guest
          .locator("a-video")
          .evaluate(
            (node: any) =>
              node.components?.material?.material?.map?.image?.currentTime || 0,
          ),
      )
      .toBeGreaterThan(0);
  } finally {
    const packetPath = test.info().outputPath("shared-wall-packets.json");
    await writeFile(
      packetPath,
      JSON.stringify(
        {
          admin: adminEvents.packets,
          guest: guestEvents.packets,
          other: otherEvents.packets,
        },
        null,
        2,
      ),
    );
    await test
      .info()
      .attach("shared-wall-packets", {
        path: packetPath,
        contentType: "application/json",
      });
    await guestContext.close().catch(() => {});
    await otherContext.close().catch(() => {});
    if (binding)
      await mutation(
        page,
        `/api/v1/walls/${wall.id}/design?expected_revision=${binding.revision}`,
        "DELETE",
      );
    await mutation(
      page,
      `/api/v1/wall-presets/${preset.id}?expected_revision=1`,
      "DELETE",
    );
    await mutation(page, `/api/v1/admin/walls/${wall.id}`, "DELETE");
    await mutation(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
    await mutation(page, `/api/v1/wall-assets/${asset.id}`, "DELETE");
  }
});
