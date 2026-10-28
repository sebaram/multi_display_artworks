import { Link } from "react-router-dom";
import { useApi, Status } from "../../app/ui";
import type { RoomSummary } from "../../api/types";
import { useSession } from "../../app/context";
export default function Tools() {
  const { session } = useSession();
  const { data, loading, error } = useApi<RoomSummary[]>("/api/v1/rooms");
  return (
    <main className="page tools-page">
      <div className="eyebrow">LAB / CONNECTED EXPERIENCES</div>
      <h1>공간을 확장하는 도구</h1>
      <p>휴대폰과 XR 기기를 연결해 전시를 다른 방식으로 경험하세요.</p>
      <Status loading={loading} error={error} />
      <div className="tool-grid">
        {session.is_admin && (
          <article>
            <div className="tool-symbol">▰</div>
            <h2>미디어 스트림</h2>
            <p>
              폰 카메라 전송과 RTSP 변환을 관리하고 실제 HLS 재생을 확인합니다.
            </p>
            <Link className="button" to="/tools/streams">
              미디어 관리 ↗
            </Link>
          </article>
        )}
        <article>
          <div className="tool-symbol">◎</div>
          <h2>AR Companion</h2>
          <p>폰 카메라의 마커 위치를 같은 방의 XR 화면으로 보냅니다.</p>
          {data?.map((room) => (
            <Link
              className="button"
              key={room.id}
              to={`/ar-companion?room_id=${room.id}`}
            >
              {room.name} 연결 ↗
            </Link>
          ))}
        </article>
        <article>
          <div className="tool-symbol">⌁</div>
          <h2>제스처 · 터치포인트</h2>
          <p>실시간 제스처와 터치 입력을 확인하는 도구입니다.</p>
          <Link className="button" to="/gesture-mark/test">
            도구 열기 ↗
          </Link>
        </article>
      </div>
    </main>
  );
}
