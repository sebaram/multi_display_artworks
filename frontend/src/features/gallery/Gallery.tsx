import { useState } from "react";
import { Link } from "react-router-dom";
import type { RoomSummary } from "../../api/types";
import { useApi, Status, Empty } from "../../app/ui";
export default function Gallery() {
  const { data, loading, error } = useApi<RoomSummary[]>("/api/v1/rooms");
  const [query, setQuery] = useState("");
  const rooms = data?.filter((r) =>
    `${r.name} ${r.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="catalog">
      <div className="eyebrow">META MUSEUM / EXHIBITIONS</div>
      <section className="catalog-heading">
        <div>
          <h1>
            공간을 넘어,
            <br />
            함께 만나는 전시.
          </h1>
          <p>작품과 사람, 새로운 관점을 연결하는 온라인 갤러리</p>
        </div>
        <label className="search">
          전시 검색
          <input
            type="search"
            placeholder="전시 이름이나 설명"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </section>
      <div className="section-heading">
        <h2>지금 열려 있는 공간</h2>
        <span>{rooms?.length ?? 0}개 전시</span>
      </div>
      <Status loading={loading} error={error} />
      <div className="room-grid">
        {rooms?.map((room, index) => (
          <article className="room-card" key={room.id}>
            <Link
              className={`room-cover cover-${index % 4}`}
              to={`/room?room_id=${room.id}`}
              aria-label={`${room.name} 입장`}
            >
              <span className="cover-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="architectural-shape" />
              <span className="cover-enter">전시 입장 ↗</span>
            </Link>
            <div className="room-card-body">
              <div className="eyebrow">
                VIRTUAL EXHIBITION · {room.walls.length} WALLS
              </div>
              <h3>
                <Link to={`/room?room_id=${room.id}`}>{room.name}</Link>
              </h3>
              <p>{room.description}</p>
              <div className="wall-links">
                {room.walls.map((w) => (
                  <Link to={`/wall?wall_id=${w.id}`} key={w.id}>
                    {w.name} ↗
                  </Link>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      {rooms?.length === 0 && (
        <Empty>
          {query
            ? "검색 결과가 없습니다. 다른 검색어를 입력하세요."
            : "아직 공개된 전시가 없습니다."}
        </Empty>
      )}
      <footer className="catalog-footer">
        <span>당신의 시선으로 완성되는 공간</span>
        <a href="/vendor/NOTICE.md" target="_blank" rel="noopener noreferrer">
          오픈소스·아바타 출처
        </a>
        <Link to="/tools">AR · 실험 도구 ↗</Link>
      </footer>
    </main>
  );
}
