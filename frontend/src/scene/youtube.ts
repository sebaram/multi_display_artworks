import { createLifetime } from "./lifetime";
import type { PlaybackClock } from "../wall-engine/types";
import type { VideoLayer } from "../wall-engine/types";
import { mediaTarget } from "../wall-engine/motion.js";
import { translate as t, subscribeLocale } from "../app/i18n";
let apiReady: Promise<any> | undefined;
function loadYouTube() {
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT);
  return (apiReady ??= new Promise((resolve, reject) => {
    const previous = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve((window as any).YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiReady = undefined;
      reject(Error("youtube_unavailable"));
    };
    document.head.append(script);
  }));
}
export function syncYouTubePlayer(
  player: any,
  clock: PlaybackClock & { layer?: VideoLayer },
) {
  if (!Number.isFinite(clock.positionSeconds)) return;
  const layer = clock.layer;
  const duration = player.getDuration?.();
  const target = layer
    ? mediaTarget(
        clock.positionSeconds,
        layer,
        Number.isFinite(duration) && duration > 0 ? duration : undefined,
      )
    : clock.positionSeconds;
  const rate = clock.rate * (layer?.motionSpeed ?? 1);
  const playing = clock.playing && rate > 0;
  const actual = Number(player.getCurrentTime?.());
  if (!Number.isFinite(actual) || Math.abs(actual - target) > 0.5)
    player.seekTo(target, true);
  const state = player.getPlayerState?.();
  if (playing && state !== 1 && state !== 3) player.playVideo();
  if (!playing && state !== 2) player.pauseVideo();
  if (rate > 0 && player.getPlaybackRate?.() !== rate)
    player.setPlaybackRate?.(rate);
}
export function mountYouTube({
  container,
  videoId,
  getClock,
  onError,
}: {
  container: HTMLElement;
  videoId: string;
  getClock: () => PlaybackClock | undefined;
  onError: (message: string) => void;
}) {
  const life = createLifetime();
  let player: any;
  let ready = false;
  let playing = false;
  let lastError: (() => string) | undefined;
  const report = (message: () => string) => {
    lastError = message;
    if (!life.disposed) onError(message());
  };
  life.add(
    subscribeLocale(() => {
      if (lastError && !life.disposed) onError(lastError());
    }),
  );
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    report(() =>
      t(
        "올바르지 않은 YouTube 영상 ID입니다.",
        "The YouTube video ID is invalid.",
      ),
    );
    return { unmute() {}, dispose: life.dispose };
  }
  const holder = document.createElement("div");
  container.append(holder);
  life.add(() => {
    ready = false;
    player?.destroy?.();
    holder.remove();
  });
  void loadYouTube()
    .then((YT) => {
      if (life.disposed) return;
      player = new YT.Player(holder, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          origin: location.origin,
          rel: 0,
        },
        events: {
          onReady(event: any) {
            if (life.disposed) {
              event.target.destroy();
              return;
            }
            ready = true;
            event.target.mute();
            const clock = getClock();
            if (clock) syncYouTubePlayer(event.target, clock);
          },
          onError(event: any) {
            if (!life.disposed)
              report(() =>
                t(
                  "YouTube 재생 오류 ({code}). 원본 링크를 열어 확인하세요.",
                  "YouTube playback error ({code}). Open the original link to check.",
                  { code: event.data },
                ),
              );
          },
        },
      });
      const timer = window.setInterval(() => {
        if (!ready || life.disposed) return;
        const clock = getClock();
        if (clock) {
          syncYouTubePlayer(player, clock);
          playing = clock.playing;
        } else {
          playing = false;
          player.pauseVideo();
        }
      }, 250);
      life.add(() => clearInterval(timer));
    })
    .catch((error) => {
      if (!life.disposed)
        report(() =>
          error.message === "youtube_unavailable"
            ? t(
                "YouTube 플레이어에 연결하지 못했습니다. 원본 링크를 열어 주세요.",
                "Unable to connect to YouTube. Open the original video link.",
              )
            : error.message,
        );
    });
  return {
    unmute() {
      if (!ready) return;
      player.unMute();
      if (playing) player.playVideo();
    },
    dispose: life.dispose,
  };
}
