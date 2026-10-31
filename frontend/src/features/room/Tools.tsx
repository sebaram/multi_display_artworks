import { useI18n } from "../../app/i18n";
import { Link } from "react-router-dom";
import { useApi, Status } from "../../app/ui";
import type { RoomSummary } from "../../api/types";
import { useSession } from "../../app/context";
export default function Tools() {
  const { t } = useI18n();
  const { session } = useSession();
  const { data, loading, error } = useApi<RoomSummary[]>("/api/v1/rooms");
  return (
    <main className="page tools-page">
      <div className="eyebrow">{t("실험실 / 연결된 경험", "LAB / CONNECTED EXPERIENCES")}</div>
      <h1>{t("공간을 확장하는 도구", "Tools that extend your space")}</h1>
      <p>{t("휴대폰과 XR 기기를 연결해 전시를 다른 방식으로 경험하세요.", "Connect your phone and XR device to experience the exhibition in new ways.")}</p>
      <Status loading={loading} error={error} />
      <div className="tool-grid">
        <article>
          <div className="tool-symbol">◉</div>
          <h2>{t("시선 실험실", "Gaze lab")}</h2>
          <p>{t("관심 대상, 응시 시간과 필터를 조절하고 절차적 시선을 비교·기록합니다.", "Adjust targets, dwell time and filters to compare and record procedural gaze.")}</p>
          <Link className="button" to="/tools/gaze-lab">{t("실험실 열기 ↗", "Open lab ↗")}</Link>
        </article>
        {session.is_admin && (
          <article>
            <div className="tool-symbol">▰</div>
            <h2>{t("미디어 스트림", "Media streams")}</h2>
            <p>
              {t("폰 카메라 전송과 RTSP 변환을 관리하고 실제 HLS 재생을 확인합니다.", "Manage phone camera streams and RTSP conversion, and check HLS playback.")}
            </p>
            <Link className="button" to="/tools/streams">
              {t("미디어 관리 ↗", "Manage media ↗")}
            </Link>
          </article>
        )}
        <article>
          <div className="tool-symbol">◎</div>
          <h2>{t("AR 컴패니언", "AR Companion")}</h2>
          <p>{t("폰 카메라의 마커 위치를 같은 방의 XR 화면으로 보냅니다.", "Send marker positions from your phone camera to the XR view in the same room.")}</p>
          {data?.map((room) => (
            <Link
              className="button"
              key={room.id}
              to={`/ar-companion?room_id=${room.id}`}
            >
              {t("{name} 연결 ↗", "Connect {name} ↗", { name: room.name || room.id })}
            </Link>
          ))}
        </article>
        <article>
          <div className="tool-symbol">⌁</div>
          <h2>{t("제스처 · 터치포인트", "Gestures · Touchpoints")}</h2>
          <p>{t("실시간 제스처와 터치 입력을 확인하는 도구입니다.", "Inspect live gesture and touch input.")}</p>
          <Link className="button" to="/gesture-mark/test">
            {t("도구 열기 ↗", "Open tool ↗")}
          </Link>
        </article>
      </div>
    </main>
  );
}
