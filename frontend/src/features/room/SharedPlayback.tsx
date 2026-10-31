import { useI18n } from "../../app/i18n";
import { localizeRoomMessage } from "./messages";
import { useState } from "react";

export default function SharedPlayback({
  wallId,
  title,
  command,
}: {
  wallId: string;
  title: string;
  command: (
    wallId: string,
    action: "play" | "pause" | "seek",
    position?: number,
  ) => boolean;
}) {
  const { t } = useI18n();
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  function send(action: "play" | "pause" | "seek") {
    setError(
      command(wallId, action, action === "seek" ? position : undefined)
        ? ""
        : t("공유 재생에 연결하지 못했습니다. 연결 후 다시 시도하세요.", "Could not connect to shared playback. Connect and try again."),
    );
  }
  return (
    <details className="shared-playback">
      <summary>{t("{title} 공유 재생 제어", "{title} shared playback controls", { title })}</summary>
      <div className="form-actions">
        <button aria-label={t("{title} 공유 재생", "{title} shared play", { title })} onClick={() => send("play")}>
          {t("재생", "Play")}
        </button>
        <button
          aria-label={t("{title} 공유 일시정지", "{title} shared pause", { title })}
          onClick={() => send("pause")}
        >
          {t("일시정지", "Pause")}
        </button>
        <label>
          {t("이동 시간 (초)", "Seek time (seconds)")}
          <input
            aria-label={t("{title} 이동 시간 (초)", "{title} seek time (seconds)", { title })}
            type="number"
            min={0}
            step={0.1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </label>
        <button
          aria-label={t("{title} 공유 위치 이동", "{title} shared seek", { title })}
          onClick={() => send("seek")}
        >
          {t("위치 이동", "Seek")}
        </button>
      </div>
      {error && <p role="status">{localizeRoomMessage(error)}</p>}
    </details>
  );
}
