import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, write } from "../../api/client";
import { useApi, Status, Empty } from "../../app/ui";
import { useSession } from "../../app/context";
import { legacyResource } from "../../app/routes";
import type { DocumentDTO, ResourceSpec } from "../../api/types";
import { Field, formBody } from "./Fields";
import { useI18n, translate as t } from "../../app/i18n";
import { resourceLabel } from "./labels";
export default function Admin() {
  useI18n();
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
        <h1>{t("스튜디오", "Studio")}</h1>
        <p>
          {t(
            "관리자 로그인이 필요합니다.",
            "Administrator sign in is required.",
          )}
        </p>
        <Link
          className="button primary"
          to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          {t("로그인", "Sign in")}
        </Link>
      </main>
    );
  if (!session.is_admin)
    return (
      <main className="page">
        <h1>{t("접근 권한이 없습니다.", "You do not have access.")}</h1>
        <Link to="/">{t("전시로 돌아가기", "Back to exhibitions")}</Link>
      </main>
    );
  return (
    <main className="studio">
      <aside className="studio-nav">
        <div className="eyebrow">MANAGEMENT STUDIO</div>
        <h1>{t("공간 관리", "Manage spaces")}</h1>
        <nav aria-label={t("관리 리소스", "Administration resources")}>
          {schema.data?.resources.map((s) => (
            <Link
              className={s.name === resource ? "active" : ""}
              key={s.name}
              to={`/kwanri/${s.name}`}
            >
              {resourceLabel(s.name, s.label)}
              <span>↗</span>
            </Link>
          ))}
        </nav>
        <Link className="studio-bottom" to="/wall-editor">
          {t("월 디자인 스튜디오 ↗", "Wall design studio ↗")}
        </Link>
      </aside>
      <section className="studio-content">
        <div className="section-heading">
          <div>
            <div className="eyebrow">COLLECTION / {resource.toUpperCase()}</div>
            <h2>
              {spec
                ? resourceLabel(spec.name, spec.label)
                : t("관리", "Manage")}
            </h2>
          </div>
          <button className="primary" onClick={() => create()} disabled={!spec}>
            {t("+ 새로 만들기", "+ Create new")}
          </button>
        </div>
        <Status
          loading={list.loading || schema.loading}
          error={list.error || schema.error}
        />
        <label className="search">
          {t("목록 검색", "Search items")}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("이름·설명 검색", "Search names or descriptions")}
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
                <span>{t("편집 →", "Edit →")}</span>
              </button>
            ))}
        </div>
        {list.data?.items.length === 0 && (
          <Empty>
            {t(
              "등록된 항목이 없습니다. 새 항목을 만들어 보세요.",
              "No items yet. Create your first item.",
            )}
          </Empty>
        )}
        <div className="pagination">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            {t("이전", "Previous")}
          </button>
          <span>
            {list.data?.total ?? 0}
            {t("개 ·", " items · ")}
            {offset + 1}–{Math.min(offset + 50, list.data?.total || 0)}
          </span>
          <button
            disabled={offset + 50 >= (list.data?.total || 0)}
            onClick={() => setOffset((n) => n + 50)}
          >
            {t("다음", "Next")}
          </button>
        </div>
      </section>
      {draft && spec && (
        <aside className="inspector admin-inspector">
          <div className="section-heading">
            <h2>
              {id ? t("항목 편집", "Edit item") : t("새 항목", "New item")}
            </h2>
            <button
              aria-label={t("편집 닫기", "Close editor")}
              onClick={() => setDraft(null)}
            >
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
                setStatus("saved");
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
                {status === "saved" ? t("저장했습니다.", "Saved.") : status}
              </p>
            )}
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy
                  ? t("저장 중…", "Saving…")
                  : t("변경 사항 저장", "Save changes")}
              </button>
              {id && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        t("이 항목을 삭제하시겠습니까?", "Delete this item?"),
                      )
                    )
                      return;
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
                  {t("삭제", "Delete")}
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
                  {t("공개 화면에서 보기 ↗", "View public page ↗")}
                </Link>
              )}
          </form>
        </aside>
      )}
    </main>
  );
}
