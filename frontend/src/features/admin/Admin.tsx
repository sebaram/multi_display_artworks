import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, write } from "../../api/client";
import { useApi, Status, Empty } from "../../app/ui";
import { useSession } from "../../app/context";
import { legacyResource } from "../../app/routes";
import type { DocumentDTO, ResourceSpec } from "../../api/types";
import { Field, formBody } from "./Fields";
export default function Admin() {
  const { session } = useSession();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const resource = legacyResource(
    location.pathname.split("/")[2] || params.get("resource") || "rooms",
  );
  const schema = useApi<{ resources: ResourceSpec[] }>(
    session.is_admin ? "/api/v1/admin/schema" : undefined,
  );
  const spec = schema.data?.resources.find((s) => s.name === resource);
  const [offset, setOffset] = useState(0);
  const list = useApi<{ items: DocumentDTO[]; total: number }>(
    session.is_admin
      ? `/api/v1/admin/${resource}?offset=${offset}&limit=50`
      : undefined,
  );
  const [id, setId] = useState<string | null>(params.get("id"));
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const openedCreateRoute = useRef<string | null>(null);
  const requestedId = params.get("id");
  useEffect(() => {
    setId(null);
    setDraft(null);
    setOffset(0);
    setError("");
    setStatus("");
  }, [resource]);
  useEffect(() => {
    if (!requestedId || !session.is_admin) return;
    let live = true;
    api<DocumentDTO>(`/api/v1/admin/${resource}/${requestedId}`)
      .then((saved) => {
        if (live) {
          setId(saved.id);
          setDraft(saved);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [resource, requestedId, session.is_admin]);
  async function edit(item: DocumentDTO) {
    setError("");
    try {
      const saved = await api<DocumentDTO>(
        `/api/v1/admin/${resource}/${item.id}`,
      );
      setId(item.id);
      setDraft(
        Object.fromEntries(
          Object.entries(saved).filter(([k]) => !k.includes("api_key")),
        ),
      );
      setParams({ resource, id: item.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function create(updateQuery = true) {
    setId(null);
    if (updateQuery) setParams({ resource });
    setDraft(
      Object.fromEntries(
        (spec?.fields || [])
          .filter((f) => !f.readonly)
          .map((f) => [
            f.name,
            f.secret
              ? ""
              : (f.default ??
                (f.type === "boolean"
                  ? false
                  : f.type === "reference-list"
                    ? []
                    : "")),
          ]),
      ),
    );
    setError("");
    setStatus("");
  }
  useEffect(() => {
    if (location.pathname.split("/")[3] !== "new" || requestedId) {
      openedCreateRoute.current = null;
      return;
    }
    if (
      !session.is_admin ||
      !spec ||
      openedCreateRoute.current === location.key
    )
      return;
    openedCreateRoute.current = location.key;
    create(false);
  }, [
    location.pathname,
    location.key,
    requestedId,
    resource,
    session.is_admin,
    spec,
  ]);
  if (!session.authenticated)
    return (
      <main className="page">
        <h1>스튜디오</h1>
        <p>관리자 로그인이 필요합니다.</p>
        <Link
          className="button primary"
          to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          로그인
        </Link>
      </main>
    );
  if (!session.is_admin)
    return (
      <main className="page">
        <h1>접근 권한이 없습니다.</h1>
        <Link to="/">전시로 돌아가기</Link>
      </main>
    );
  return (
    <main className="studio">
      <aside className="studio-nav">
        <div className="eyebrow">MANAGEMENT STUDIO</div>
        <h1>공간 관리</h1>
        <nav aria-label="관리 리소스">
          {schema.data?.resources.map((s) => (
            <Link
              className={s.name === resource ? "active" : ""}
              key={s.name}
              to={`/kwanri/${s.name}`}
            >
              {s.label}
              <span>↗</span>
            </Link>
          ))}
        </nav>
        <Link className="studio-bottom" to="/wall-editor">
          월 디자인 스튜디오 ↗
        </Link>
      </aside>
      <section className="studio-content">
        <div className="section-heading">
          <div>
            <div className="eyebrow">COLLECTION / {resource.toUpperCase()}</div>
            <h2>{spec?.label || "관리"}</h2>
          </div>
          <button className="primary" onClick={() => create()} disabled={!spec}>
            + 새로 만들기
          </button>
        </div>
        <Status
          loading={list.loading || schema.loading}
          error={list.error || schema.error}
        />
        <label className="search">
          목록 검색
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·설명 검색"
          />
        </label>
        <div className="document-list">
          {list.data?.items
            .filter((i) =>
              `${i.name || ""} ${i.description || ""} ${i.provider || ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((i) => (
              <button
                className={`document-row ${id === i.id ? "selected" : ""}`}
                key={i.id}
                onClick={() => void edit(i)}
              >
                <span className="document-icon">
                  {resource === "rooms"
                    ? "▧"
                    : resource === "walls"
                      ? "▥"
                      : "◇"}
                </span>
                <span>
                  <strong>{i.name || String(i.provider || i.id)}</strong>
                  <small>{i.description || i.id}</small>
                </span>
                <span>편집 →</span>
              </button>
            ))}
        </div>
        {list.data?.items.length === 0 && (
          <Empty>등록된 항목이 없습니다. 새 항목을 만들어 보세요.</Empty>
        )}
        <div className="pagination">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            이전
          </button>
          <span>
            {list.data?.total ?? 0}개 · {offset + 1}–
            {Math.min(offset + 50, list.data?.total || 0)}
          </span>
          <button
            disabled={offset + 50 >= (list.data?.total || 0)}
            onClick={() => setOffset((n) => n + 50)}
          >
            다음
          </button>
        </div>
      </section>
      {draft && spec && (
        <aside className="inspector admin-inspector">
          <div className="section-heading">
            <h2>{id ? "항목 편집" : "새 항목"}</h2>
            <button aria-label="편집 닫기" onClick={() => setDraft(null)}>
              ×
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setStatus("");
              try {
                const body = formBody(spec.fields, draft);
                const saved = await write(
                  `/api/v1/admin/${resource}${id ? `/${id}` : ""}`,
                  id ? "PATCH" : "POST",
                  body,
                );
                setId(saved.id);
                setDraft(saved);
                setStatus("저장했습니다.");
                list.refresh();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {spec.fields.map((field) => (
              <Field
                key={`${resource}-${field.name}`}
                field={field}
                value={draft[field.name]}
                change={(value) =>
                  setDraft((d) => ({ ...d, [field.name]: value }))
                }
                editing={!!id}
              />
            ))}
            <Status error={error} />
            {status && (
              <p role="status" className="success">
                {status}
              </p>
            )}
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy ? "저장 중…" : "변경 사항 저장"}
              </button>
              {id && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("이 항목을 삭제하시겠습니까?")) return;
                    setBusy(true);
                    try {
                      await write(`/api/v1/admin/${resource}/${id}`, "DELETE");
                      setDraft(null);
                      setId(null);
                      list.refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  삭제
                </button>
              )}
            </div>
            {id &&
              [
                "rooms",
                "walls",
                "images",
                "splats",
                "gltfs",
                "webpages",
              ].includes(resource) && (
                <Link
                  className="button"
                  to={
                    resource === "rooms"
                      ? `/room?room_id=${id}`
                      : resource === "walls"
                        ? `/wall?wall_id=${id}`
                        : `/element?wall_element_id=${id}&type=${({ images: "image", splats: "gaussian_splat", gltfs: "gltf", webpages: "webpage" } as Record<string, string>)[resource]}`
                  }
                >
                  공개 화면에서 보기 ↗
                </Link>
              )}
          </form>
        </aside>
      )}
    </main>
  );
}
