import { it, expect, vi } from "vitest";
import { syncYouTubePlayer, mountYouTube } from "../../src/scene/youtube";
import { setLocale } from "../../src/app/i18n";
it("updates an existing YouTube error in place and unsubscribes on disposal", () => {
  setLocale("ko");
  const error = vi.fn();
  const player = mountYouTube({
    container: document.createElement("div"),
    videoId: "invalid",
    getClock: () => undefined,
    onError: error,
  });
  expect(error).toHaveBeenLastCalledWith(
    "올바르지 않은 YouTube 영상 ID입니다.",
  );
  setLocale("en");
  expect(error).toHaveBeenLastCalledWith("The YouTube video ID is invalid.");
  player.dispose();
  error.mockClear();
  setLocale("ko");
  expect(error).not.toHaveBeenCalled();
});
it("corrects late readiness, pause, seek and subsequent playback drift", () => {
  const player = {
    getCurrentTime: () => 1,
    getPlayerState: () => 2,
    seekTo: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
  };
  syncYouTubePlayer(player, { positionSeconds: 7, playing: true, rate: 1 });
  expect(player.seekTo).toHaveBeenCalledWith(7, true);
  expect(player.playVideo).toHaveBeenCalledTimes(1);
  player.getCurrentTime = () => 7;
  player.getPlayerState = () => 1;
  syncYouTubePlayer(player, { positionSeconds: 7.2, playing: false, rate: 1 });
  expect(player.seekTo).toHaveBeenCalledTimes(1);
  expect(player.pauseVideo).toHaveBeenCalledTimes(1);
});
