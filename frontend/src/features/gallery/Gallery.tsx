import { useState } from "react";
import { Link } from "react-router-dom";
import type { RoomSummary } from "../../api/types";
import { useApi, Status, Empty } from "../../app/ui";
import { useI18n, translate as t } from "../../app/i18n";
export default function Gallery() {
  useI18n();
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
            {t("공간을 넘어,", "Beyond spaces,")}
            <br />
            {t("함께 만나는 전시.", "exhibitions we share.")}
          </h1>
          <p>
            {t(
              "작품과 사람, 새로운 관점을 연결하는 온라인 갤러리",
              "An online gallery connecting art, people and new perspectives",
            )}
          </p>
        </div>
        <label className="search">
          {t("전시 검색", "Search exhibitions")}
          <input
            type="search"
            placeholder={t(
              "전시 이름이나 설명",
              "Exhibition name or description",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </section>
      <div className="section-heading">
        <h2>{t("지금 열려 있는 공간", "Spaces open now")}</h2>
        <span>
          {rooms?.length ?? 0}
          {t("개 전시", " exhibitions")}
        </span>
      </div>
      <Status loading={loading} error={error} />
      <div className="room-grid">
        {rooms?.map((room, index) => (
          <article className="room-card" key={room.id}>
            <Link
              className={`room-cover cover-${index % 4}`}
              to={`/room?room_id=${room.id}`}
              aria-label={t("{name} 입장", "Enter {name}", {
                name: room.name || room.id,
              })}
            >
              <span className="cover-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="architectural-shape" />
              <span className="cover-enter">
                {t("전시 입장 ↗", "Enter exhibition ↗")}
              </span>
            </Link>
            <div className="room-card-body">
              <div className="eyebrow">
                {t(
                  "가상 전시 · {count}개 월",
                  "VIRTUAL EXHIBITION · {count} WALLS",
                  { count: room.walls.length },
                )}
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
            ? t(
                "검색 결과가 없습니다. 다른 검색어를 입력하세요.",
                "No results. Try a different search.",
              )
            : t("아직 공개된 전시가 없습니다.", "No exhibitions are open yet.")}
        </Empty>
      )}
      <footer className="catalog-footer">
        <span>
          {t(
            "당신의 시선으로 완성되는 공간",
            "A space shaped by your perspective",
          )}
        </span>
        <a href="/vendor/NOTICE.md" target="_blank" rel="noopener noreferrer">
          {t("오픈소스·아바타 출처", "Open source and avatar credits")}
        </a>
        <Link to="/tools">
          {t("AR · 실험 도구 ↗", "AR · Research tools ↗")}
        </Link>
      </footer>
    </main>
  );
}
