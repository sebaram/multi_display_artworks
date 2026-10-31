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

test("real microphone MediaRecorder posts STT audio and relays the provider transcript", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.addInitScript(() => {
    const state = window as any;
    state.__recordedAudioBytes = 0;
    const OriginalRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends OriginalRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        this.addEventListener(
          "dataavailable",
          (event) => (state.__recordedAudioBytes += event.data.size),
        );
      }
    };
  });
  const whisper = (
    await (await page.request.get("/api/v1/admin/whisper-configs")).json()
  ).items[0];
  const before = {
    provider: whisper.provider,
    api_base: whisper.api_base,
    model: whisper.model,
    language: whisper.language,
    enabled: whisper.enabled,
  };
  await mutate(page, `/api/v1/admin/whisper-configs/${whisper.id}`, "PATCH", {
    provider: "local",
    api_base: "http://127.0.0.1:8766/v1",
    model: "synthetic",
    enabled: true,
  });
  const room = await mutate(page, "/api/v1/admin/rooms", "POST", {
    name: `STT ${Date.now()}`,
    description: "Owned synthetic transcription acceptance",
  });
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await page.goto(`/room?room_id=${room.id}`);
    await guest.goto(`/room?room_id=${room.id}`);
    await expect(page.locator("#voice-admin-btn")).toBeVisible({
      timeout: 20000,
    });
    await expect(guest.locator(".remote-avatar")).toHaveCount(1);
    await page.locator("#voice-admin-btn").click();
    await page.locator("#voice-btn").click();
    await expect(page.locator("#voice-btn")).toContainText("음소거");
    const transcribed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/transcribe") &&
        response.request().method() === "POST",
      { timeout: 20000 },
    );
    await page.locator("#voice-btn").click();
    const response = await transcribed;
    expect(response.status()).toBe(200);
    expect((await response.json()).text).toBe("Synthetic migration transcript");
    expect(
      await page.evaluate(() => (window as any).__recordedAudioBytes),
    ).toBeGreaterThan(500);
    await expect
      .poll(() => guest.locator(".transcript-bubble").getAttribute("value"))
      .toContain("Synthetic migration transcript");
    await page.locator("#voice-admin-btn").click();
  } finally {
    await guestContext.close();
    await mutate(
      page,
      `/api/v1/admin/whisper-configs/${whisper.id}`,
      "PATCH",
      before,
    );
    await mutate(page, `/api/v1/admin/rooms/${room.id}`, "DELETE");
  }
});
