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
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  function send(action: "play" | "pause" | "seek") {
    setError(
      command(wallId, action, action === "seek" ? position : undefined)
        ? ""
        : "공유 재생에 연결하지 못했습니다. 연결 후 다시 시도하세요.",
    );
  }
  return (
    <details className="shared-playback">
      <summary>{title} 공유 재생 제어</summary>
      <div className="form-actions">
        <button aria-label={`${title} 공유 재생`} onClick={() => send("play")}>
          재생
        </button>
        <button
          aria-label={`${title} 공유 일시정지`}
          onClick={() => send("pause")}
        >
          일시정지
        </button>
        <label>
          이동 시간 (초)
          <input
            aria-label={`${title} 이동 시간 (초)`}
            type="number"
            min={0}
            step={0.1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </label>
        <button
          aria-label={`${title} 공유 위치 이동`}
          onClick={() => send("seek")}
        >
          위치 이동
        </button>
      </div>
      {error && <p role="status">{error}</p>}
    </details>
  );
}
