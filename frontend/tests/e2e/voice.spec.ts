import { test, expect } from "@playwright/test";
import { ROOM, login } from "./helpers";
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

async function instrumentVoice(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.__microphoneTracks = [];
    state.__voicePeers = [];
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      if (constraints?.audio)
        state.__microphoneTracks.push(...stream.getAudioTracks());
      return stream;
    };
    const OriginalPeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalPeer {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        state.__voicePeers.push(this);
      }
    };
  });
}

async function expectConnected(page: import("@playwright/test").Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__voicePeers.some(
            (peer: RTCPeerConnection) =>
              peer.connectionState === "connected" &&
              peer
                .getReceivers()
                .some(
                  (receiver) =>
                    receiver.track.kind === "audio" &&
                    receiver.track.readyState === "live",
                ),
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
}
test("actual admin voice enable, WebRTC tracks and navigation microphone cleanup", async ({
  page,
  browser,
}) => {
  await instrumentVoice(page);
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("ADMIN BROWSER", message.text());
  });
  page.on("pageerror", (error) => console.log("ADMIN PAGE", error.message));
  await login(page);
  await page.goto(`/room?room_id=${ROOM}`);
  await expect(page.locator("#voice-admin-btn")).toBeVisible({
    timeout: 20000,
  });
  const guestContext = await browser.newContext({
    permissions: ["microphone"],
  });
  const guest = await guestContext.newPage();
  guest.on("console", (message) => {
    if (message.type() === "error")
      console.log("GUEST BROWSER", message.text());
  });
  await instrumentVoice(guest);
  await guest.goto(`/room?room_id=${ROOM}`);
  await expect(guest.locator("#voice-btn")).toBeVisible({ timeout: 20000 });
  if (!(await page.locator("#voice-admin-btn").innerText()).includes("ON"))
    await page.locator("#voice-admin-btn").click();
  await expect(guest.locator("#voice-btn")).toContainText("Join Voice");
  await page.locator("#voice-btn").click();
  await expect(page.locator("#voice-btn")).toContainText("Muted");
  await guest.locator("#voice-btn").click();
  await expect(guest.locator("#voice-btn")).toContainText("Muted");
  await expect
    .poll(() =>
      guest.evaluate(() => (window as any).__microphoneTracks?.[0]?.readyState),
    )
    .toBe("live");
  await expect(page.locator('[id^="voice-audio-"]')).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(guest.locator('[id^="voice-audio-"]')).toHaveCount(1, {
    timeout: 15000,
  });
  await expectConnected(page);
  await expectConnected(guest);
  await guest.locator("#voice-btn").click();
  await expect(guest.locator("#voice-btn")).toContainText("Speaking");
  await expect
    .poll(() =>
      guest.evaluate(() => (window as any).__microphoneTracks[0].enabled),
    )
    .toBe(true);
  await guest.getByRole("link", { name: "← 전시 목록" }).click();
  await expect
    .poll(() =>
      guest.evaluate(() => (window as any).__microphoneTracks?.[0]?.readyState),
    )
    .toBe("ended");
  await expect(guest.locator("#voice-ui")).toHaveCount(0);
  await expect
    .poll(() =>
      guest.evaluate(() =>
        (window as any).__voicePeers.every(
          (peer: RTCPeerConnection) => peer.connectionState === "closed",
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator('[id^="voice-audio-"]')).toHaveCount(0);
  await guest.goto(`/room?room_id=${ROOM}`);
  await expect(guest.locator("#voice-btn")).toContainText("Join Voice", {
    timeout: 20000,
  });
  await guest.locator("#voice-btn").click();
  await expect(guest.locator("#voice-btn")).toContainText("Muted");
  await expectConnected(guest);
  await expectConnected(page);
  await page.locator("#voice-admin-btn").click();
  await expect(guest.locator("#voice-btn")).toContainText("Voice Off");
  await expect
    .poll(() =>
      guest.evaluate(() =>
        (window as any).__microphoneTracks.every(
          (track: MediaStreamTrack) => track.readyState === "ended",
        ),
      ),
    )
    .toBe(true);
  await guestContext.close();
});
