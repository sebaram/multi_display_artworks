import { localizeRoomMessage } from "./messages";
import { useI18n } from "../../app/i18n";
import { useEffect, useRef, useState } from "react";
import { mountYouTube } from "../../scene/youtube";
import type { PlaybackClock } from "../../wall-engine/types";
export default function YouTubePanel({
  videoId,
  title,
  getClock,
  command,
  isAdmin,
  onClose,
}: {
  videoId: string;
  title: string;
  getClock: () => PlaybackClock | undefined;
  command: (action: "play" | "pause" | "seek", position?: number) => boolean;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null),
    adapter = useRef<ReturnType<typeof mountYouTube> | undefined>(undefined);
  const [error, setError] = useState(""),
    [position, setPosition] = useState(0);
  const clockRef = useRef(getClock);
  clockRef.current = getClock;
  useEffect(() => {
    if (!container.current) return;
    adapter.current = mountYouTube({
      container: container.current,
      videoId,
      getClock: () => clockRef.current(),
      onError: setError,
    });
    return () => adapter.current?.dispose();
  }, [videoId]);
  function send(action: "play" | "pause" | "seek") {
    if (!command(action, action === "seek" ? position : undefined))
      setError(
        t("공유 재생 연결이 준비되지 않았습니다. 방 연결 상태를 확인하고 다시 시도하세요.", "Shared playback is not ready. Check the room connection and try again."),
      );
  }
  return (
    <section className="youtube-panel" aria-label={t("공유 YouTube 플레이어", "Shared YouTube player")}>
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t("동기화 플레이어", "SYNCHRONIZED PLAYER")}</div>
          <h2>{title || "YouTube"}</h2>
        </div>
        <button onClick={onClose} aria-label={t("YouTube 플레이어 닫기", "Close YouTube player")}>
          ×
        </button>
      </div>
      <div className="youtube-frame" ref={container} />
      {error && (
        <p role="status" className="notice error">
          {localizeRoomMessage(error)}
        </p>
      )}
      <div className="form-actions">
        <button onClick={() => adapter.current?.unmute()}>
          {t("이 기기 소리 켜기", "Enable sound on this device")}
        </button>
        <a
          className="button"
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.youtube.com/watch?v=${videoId}`}
        >
          {t("원본 영상 ↗", "Original video ↗")}
        </a>
      </div>
      {isAdmin && (
        <div className="form-actions">
          <button onClick={() => send("play")}>{t("공유 재생", "Shared play")}</button>
          <button onClick={() => send("pause")}>{t("공유 일시정지", "Shared pause")}</button>
          <label>
            {t("이동 시간 (초)", "Seek time (seconds)")}
            <input
              type="number"
              min={0}
              step={0.1}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
          <button onClick={() => send("seek")}>{t("공유 위치 이동", "Shared seek")}</button>
        </div>
      )}
      <p>
        {t("이 플레이어는 같은 방의 공유 영상 시계를 따릅니다. 영상 준비 후 현재 위치로 맞춰집니다.", "This player follows the shared video clock in this room and seeks to the current position when ready.")}
      </p>
    </section>
  );
}
