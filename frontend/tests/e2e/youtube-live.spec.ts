import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { login, mutate } from "./helpers";

async function setup(page: Page) {
  page.setDefaultTimeout(10000);
  await login(page);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `YouTube ${unique}`,
    description: "Owned external-player acceptance",
  });
  const wall = await mutate(page, "/api/v1/admin/walls", "POST", {
    name: `YouTube wall ${unique}`,
    description: "Owned wall",
    room: room.id,
    position: "0 1.6 -3",
    rotation: "0 0 0",
    width: 6,
    height: 4,
    depth: 0.2,
  });
  const config = (
    await (await page.request.get("/wall-presets/builtin-0.json")).json()
  ).config;
  Object.assign(config.state, {
    paused: true,
    showVideo: true,
    videoLayers: [
      {
        id: "yt",
        youtube: { id: "M7lc1UVf-VE" },
        x: 50,
        y: 50,
        width: 40,
        enabled: true,
        screens: {},
      },
    ],
  });
  let revision = 0;
  return {
    room,
    wall,
    config,
    async apply() {
      const binding = await mutate(
        page,
        `/api/v1/walls/${wall.id}/design`,
        "PUT",
        { config, expected_revision: revision },
      );
      revision = binding.revision;
    },
    async remove() {
      await mutate(
        page,
        `/api/v1/walls/${wall.id}/design?expected_revision=${revision}`,
        "DELETE",
      );
      revision = 0;
    },
    async cleanup() {
      const csrf = await (
        await page.request.get("/api/v1/auth/csrf", { timeout: 10000 })
      ).json();
      const headers = {
        Origin: "http://127.0.0.1:5173",
        "X-CSRF-Token": csrf.csrf_token,
      };
      async function remove(path: string) {
        const response = await page.request.delete(path, {
          headers,
          timeout: 10000,
        });
        if (!response.ok() && response.status() !== 404)
          throw Error(`Cleanup ${response.status()} ${await response.text()}`);
      }
      const current = await (
        await page.request.get(`/api/v1/walls/${wall.id}/design`, {
          timeout: 10000,
        })
      ).json();
      if (current)
        await remove(
          `/api/v1/walls/${wall.id}/design?expected_revision=${current.revision}`,
        );
      await remove(`/api/v1/admin/walls/${wall.id}`);
      await remove(`/api/v1/admin/rooms/${room.id}`);
    },
  };
}
async function finishCleanup(
  state: Awaited<ReturnType<typeof setup>>,
  primaryError: unknown,
) {
  try {
    await state.cleanup();
  } catch (error) {
    if (!primaryError) throw error;
    await test.info().attach("cleanup-error", {
      body: String(error),
      contentType: "text/plain",
    });
  }
}

test("external YouTube API fixture follows real live apply/source replacement/remove/navigation", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      path: "tests/fixtures/youtube-api.js",
      contentType: "text/javascript",
    }),
  );
  const state = await setup(page);
  let primaryError: unknown;
  try {
    await state.apply();
    await page.goto(`/room?room_id=${state.room.id}`);
    await page.getByRole("button", { name: "▶ YouTube", exact: true }).click();
    await expect(page.locator(".youtube-panel iframe")).toHaveCount(1);
    const panel = page.locator(".youtube-panel");
    await panel.getByRole("button", { name: "공유 재생", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__youtubePlayers[0].getPlayerState(),
        ),
      )
      .toBe(1);
    await panel
      .getByRole("button", { name: "공유 일시정지", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__youtubePlayers[0].getPlayerState(),
        ),
      )
      .toBe(2);
    await panel.getByLabel("이동 시간 (초)", { exact: true }).fill("7");
    await panel
      .getByRole("button", { name: "공유 위치 이동", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs((window as any).__youtubePlayers[0].getCurrentTime() - 7),
        ),
      )
      .toBeLessThan(0.6);
    state.config.state.videoLayers[0].youtube.id = "dQw4w9WgXcQ";
    await state.apply();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__youtubePlayers.at(-1).options.videoId,
        ),
      )
      .toBe("dQw4w9WgXcQ");
    expect(
      await page.evaluate(() => (window as any).__youtubePlayers[0].destroyed),
    ).toBe(true);
    await state.remove();
    await expect(page.locator(".youtube-panel")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).__youtubePlayers.every(
          (player: any) => player.destroyed,
        ),
      ),
    ).toBe(true);
    await state.apply();
    await page.getByRole("button", { name: "▶ YouTube", exact: true }).click();
    await expect(page.locator(".youtube-panel iframe")).toHaveCount(1);
    await page.getByRole("link", { name: "← 전시 목록" }).click();
    expect(
      await page.evaluate(() =>
        (window as any).__youtubePlayers.every(
          (player: any) => player.destroyed,
        ),
      ),
    ).toBe(true);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await finishCleanup(state, primaryError);
  }
});

test("live public YouTube playback or explicit provider-refusal fallback", async ({
  page,
}) => {
  test.setTimeout(60000);
  const failures: string[] = [];
  const providerRejections: { status: string; reason?: string }[] = [];
  const botRefusal = () =>
    providerRejections.find(
      ({ status, reason }) =>
        status === "LOGIN_REQUIRED" &&
        /Sign in to confirm you[’']re not a bot/i.test(reason || ""),
    );
  page.on("requestfailed", (request) => {
    if (/youtube|googlevideo|ytimg/.test(request.url())) {
      const url = new URL(request.url());
      failures.push(
        `${url.origin}${url.pathname}: ${request.failure()?.errorText}`,
      );
    }
  });
  page.on("response", async (response) => {
    if (
      response.status() >= 400 &&
      /youtube|googlevideo|ytimg/.test(response.url())
    ) {
      const url = new URL(response.url());
      failures.push(`${url.origin}${url.pathname}: HTTP ${response.status()}`);
    }
    if (
      response.url().startsWith("https://www.youtube.com/youtubei/v1/player")
    ) {
      const body = await response.json().catch(() => undefined);
      if (
        body?.playabilityStatus?.status &&
        body.playabilityStatus.status !== "OK"
      ) {
        const { status, reason } = body.playabilityStatus;
        providerRejections.push({ status, reason });
      }
    }
  });
  await page.addInitScript(() => {
    const state = window as any;
    state.__livePlayers = [];
    state.__livePlayerEvents = [];
    const yt = (state.YT = state.YT || {});
    let player: any;
    Object.defineProperty(yt, "Player", {
      configurable: true,
      get() {
        return player;
      },
      set(Original) {
        player = function (...args: any[]) {
          const events = args[1].events;
          for (const name of [
            "onReady",
            "onStateChange",
            "onError",
            "onAutoplayBlocked",
          ]) {
            const original = events[name];
            events[name] = (event: any) => {
              state.__livePlayerEvents.push({
                name,
                data: event.data,
                at: performance.now(),
              });
              original?.(event);
            };
          }
          const value = new Original(...args);
          state.__livePlayers.push(value);
          return value;
        };
        player.prototype = Original.prototype;
      },
    });
  });
  const state = await setup(page);
  let primaryError: unknown;
  let outcome: any;
  try {
    await state.apply();
    await page.goto(`/room?room_id=${state.room.id}`);
    await page.getByRole("button", { name: "▶ YouTube", exact: true }).click();
    await expect
      .poll(
        () =>
          Boolean(botRefusal()) ||
          page.evaluate(
            () => (window as any).__livePlayers?.[0]?.getDuration?.() > 0,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    if (!botRefusal()) {
      await page
        .locator(".youtube-panel")
        .getByRole("button", { name: "공유 재생", exact: true })
        .click();
      await expect
        .poll(
          () =>
            Boolean(botRefusal()) ||
            page.evaluate(() => {
              const player = (window as any).__livePlayers[0];
              // Clock correction can seek ahead while the video is still buffering.
              return (
                player.getPlayerState() === 1 && player.getCurrentTime() > 0.5
              );
            }),
          { timeout: 15000 },
        )
        .toBe(true);
    }
    if (botRefusal()) {
      const panel = page.locator(".youtube-panel");
      await expect(panel.locator(".error")).toContainText(
        "YouTube 재생 오류 (150)",
      );
      const original = panel.getByRole("link", {
        name: "원본 영상 ↗",
        exact: true,
      });
      await expect(original).toBeVisible();
      await expect(original).toHaveAttribute(
        "href",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      );
      await expect(original).toHaveAttribute("target", "_blank");
      await expect(original).toHaveAttribute("rel", "noopener noreferrer");
      outcome = {
        status: "external_blocked",
        rejection: botRefusal(),
        failures,
      };
      test
        .info()
        .annotations.push({
          type: "external_blocked",
          description: botRefusal()!.reason,
        });
      console.warn(`YouTube external_blocked: ${JSON.stringify(outcome)}`);
    } else {
      await page
        .locator(".youtube-panel")
        .getByRole("button", { name: "공유 일시정지", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).__livePlayers[0].getPlayerState(),
          ),
        )
        .toBe(2);
      await page
        .locator(".youtube-panel")
        .getByLabel("이동 시간 (초)", { exact: true })
        .fill("7");
      await page
        .locator(".youtube-panel")
        .getByRole("button", { name: "공유 위치 이동", exact: true })
        .click();
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              Math.abs((window as any).__livePlayers[0].getCurrentTime() - 7),
            ),
          { timeout: 15000 },
        )
        .toBeLessThan(0.6);
      outcome = {
        status: "playing",
        pausedAndSought: true,
        position: await page.evaluate(() =>
          (window as any).__livePlayers[0].getCurrentTime(),
        ),
        failures,
      };
    }
  } catch (error) {
    primaryError = error;
    const provider = await page
      .evaluate(() => {
        const state = window as any;
        const player = state.__livePlayers?.[0];
        return {
          playerState: player?.getPlayerState?.(),
          currentTime: player?.getCurrentTime?.(),
          duration: player?.getDuration?.(),
          muted: player?.isMuted?.(),
          iframe: document
            .querySelector(".youtube-panel iframe")
            ?.getAttribute("src"),
          panelStatus: document.querySelector(".youtube-panel .error")
            ?.textContent,
          events: state.__livePlayerEvents,
        };
      })
      .catch((captureError) => ({ captureError: String(captureError) }));
    await writeFile(
      test.info().outputPath("youtube-live-failure.json"),
      JSON.stringify({ provider, failures, providerRejections }, null, 2),
    );
    throw error;
  } finally {
    await finishCleanup(state, primaryError);
  }
  await writeFile(
    test.info().outputPath("youtube-live.json"),
    JSON.stringify(outcome, null, 2),
  );
});
