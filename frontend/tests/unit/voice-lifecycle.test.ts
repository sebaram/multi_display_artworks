import { it, expect, vi, afterEach } from "vitest";
afterEach(() => document.body.replaceChildren());
import { createVoiceChat } from "../../src/scene/voice-chat.js";
it("shows an active muted microphone and toggles its actual track", async () => {
  const track = { stop: vi.fn(), enabled: true };
  const emit = vi.fn();
  const voice = createVoiceChat({
    document,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      },
    },
    fetch: async () => ({ ok: true, json: async () => ({ enabled: false }) }),
    setTimeout: () => 0,
    RTCPeerConnection: vi.fn(),
    MediaRecorder: vi.fn(),
    AudioContext: vi.fn(),
  });
  voice.init("room", "visitor", false, { emit });
  voice.handleSocketEvent("voice_admin_toggle", { enabled: true });
  const button = document.getElementById("voice-btn")!;
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(emit).toHaveBeenCalledWith("voice.join", {
    room_id: "room",
    userId: "visitor",
  });
  expect(track.enabled).toBe(false);
  expect(button.textContent).toContain("Muted");
  button.click();
  expect(track.enabled).toBe(true);
  expect(button.textContent).toContain("Speaking");
  voice.destroy();
  expect(track.stop).toHaveBeenCalledTimes(1);
});
it("an older voice instance cannot update or remove a newer instance UI", () => {
  const deps = {
    document,
    navigator: { mediaDevices: { getUserMedia: vi.fn() } },
    fetch: vi.fn(),
    setTimeout: () => 0,
    RTCPeerConnection: vi.fn(),
    MediaRecorder: vi.fn(),
    AudioContext: vi.fn(),
  };
  const first = createVoiceChat(deps),
    second = createVoiceChat(deps);
  first.init("old", "one", false, { emit: vi.fn() });
  second.init("new", "two", false, { emit: vi.fn() });
  const buttons = document.querySelectorAll("#voice-btn");
  const newer = buttons[1];
  second.handleSocketEvent("voice_admin_toggle", { enabled: true });
  expect(newer.textContent).toContain("Join Voice");
  first.destroy();
  expect(newer.isConnected).toBe(true);
  second.destroy();
  expect(document.getElementById("voice-ui")).toBeNull();
});
it("stops microphone acquired after the scene was disposed", async () => {
  let resolveMedia: (value: any) => void = () => {};
  const media = new Promise((resolve) => {
    resolveMedia = resolve;
  });
  const stop = vi.fn();
  const voice = createVoiceChat({
    document,
    navigator: { mediaDevices: { getUserMedia: () => media } },
    fetch: vi.fn(),
    setTimeout: () => 0,
    RTCPeerConnection: vi.fn(),
    MediaRecorder: vi.fn(),
    AudioContext: vi.fn(),
  });
  voice.init("room", "visitor", false, { emit: vi.fn() });
  voice.handleSocketEvent("voice_admin_toggle", { enabled: true });
  document.getElementById("voice-btn")!.click();
  voice.destroy();
  resolveMedia({
    getTracks: () => [{ stop }],
    getAudioTracks: () => [{ stop, enabled: false }],
  });
  await media;
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(document.getElementById("voice-ui")).toBeNull();
});
