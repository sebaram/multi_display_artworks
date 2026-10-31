import { useI18n } from "../../app/i18n";
import { displayError } from "../../app/error-message";
import { useEffect, useRef, useState } from "react";
import { mountYouTube } from "../../scene/youtube";
import type { WallRenderer } from "../../wall-engine/types";
export function YouTubePreview({
  id,
  videoId,
  title,
  renderer,
  onClose,
}: {
  id: string;
  videoId: string;
  title: string;
  renderer: React.RefObject<WallRenderer | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const player = useRef<ReturnType<typeof mountYouTube> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    player.current = mountYouTube({
      container: host.current,
      videoId,
      getClock: () => {
        const layer = renderer.current
          ?.getYouTubeLayers()
          .find((v) => v.id === id);
        return layer ? { ...layer.playback, layer } : undefined;
      },
      onError: setError,
    });
    return () => {
      player.current?.dispose();
      player.current = null;
    };
  }, [id, videoId, renderer]);
  return (
    <section aria-label={t("YouTube 초안 미리보기", "YouTube draft preview")}>
      <h3>{title}</h3>
      <div className="youtube-preview" ref={host} />
      <button onClick={() => player.current?.unmute()}>
        {t("이 기기 소리 켜기", "Unmute on this device")}
      </button>{" "}
      <button onClick={onClose}>{t("닫기", "Close")}</button>
      {error && <p role="status">{displayError(error)}</p>}
      <p>
        {t(
          "이 플레이어는 편집 중인 초안의 로컬 시계를 따릅니다. 적용된 월의 공유 재생 제어는 실시간 연결이 준비되면 사용할 수 있습니다.",
          "This player follows the local clock of your draft. Shared playback controls for the applied wall become available when the live connection is ready.",
        )}
      </p>
    </section>
  );
}
