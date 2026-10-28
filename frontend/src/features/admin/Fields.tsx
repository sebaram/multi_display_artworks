import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DocumentDTO, FieldSpec } from "../../api/types";
export function Field({
  field,
  value,
  change,
  editing,
}: {
  field: FieldSpec;
  value: unknown;
  change: (value: unknown) => void;
  editing: boolean;
}) {
  if (field.readonly) return null;
  const id = `field-${field.name}`,
    required = field.required && !(editing && field.secret);
  let input;
  if (field.type === "boolean")
    input = (
      <input
        id={id}
        type="checkbox"
        checked={!!value}
        onChange={(e) => change(e.target.checked)}
      />
    );
  else if (field.reference) {
    return (
      <div className="reference-field">
        <label htmlFor={id}>
          {field.label || field.name}
          {required ? " *" : ""}
        </label>
        <ReferenceSelect
          key={field.reference}
          id={id}
          resource={field.reference}
          multiple={field.type === "reference-list"}
          required={required}
          value={value}
          change={change}
        />
      </div>
    );
  } else if (field.choices?.length)
    input = (
      <select
        id={id}
        required={required}
        value={String(value ?? "")}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">선택하세요</option>
        {field.choices.map((choice) => (
          <option
            value={typeof choice === "object" ? choice.value : choice}
            key={typeof choice === "object" ? choice.value : choice}
          >
            {typeof choice === "object" ? choice.label : choice}
          </option>
        ))}
      </select>
    );
  else if (["text", "json"].includes(field.type))
    input = (
      <textarea
        id={id}
        rows={field.type === "json" ? 5 : 3}
        required={required}
        value={
          typeof value === "string"
            ? value
            : field.type === "json"
              ? JSON.stringify(value ?? {}, null, 2)
              : ""
        }
        onChange={(e) => change(e.target.value)}
      />
    );
  else
    input = (
      <input
        id={id}
        type={
          field.secret || field.type === "password"
            ? "password"
            : field.type === "number"
              ? "number"
              : field.type === "datetime"
                ? "datetime-local"
                : "text"
        }
        step={field.type === "number" ? "any" : undefined}
        required={required}
        placeholder={editing && field.secret ? "새 키 입력 시에만 변경" : ""}
        autoComplete={field.secret ? "new-password" : "off"}
        value={String(value ?? "")}
        onChange={(e) =>
          change(
            field.type === "number"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  return (
    <label
      className={field.type === "boolean" ? "checkbox-field" : ""}
      htmlFor={id}
    >
      {field.label || field.name}
      {required ? " *" : ""}
      {input}
      {field.secret && editing && (
        <small>비워 두면 기존 비밀키를 유지합니다.</small>
      )}
    </label>
  );
}
function ReferenceSelect({
  id,
  resource,
  multiple,
  required,
  value,
  change,
}: {
  id: string;
  resource: string;
  multiple: boolean;
  required: boolean;
  value: unknown;
  change: (value: unknown) => void;
}) {
  const [page, setPage] = useState<{
    items: DocumentDTO[];
    total: number;
    offset: number;
    ready: boolean;
  }>({ items: [], total: 0, offset: 0, ready: false });
  const [extra, setExtra] = useState<DocumentDTO[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    api<{ items: DocumentDTO[]; total: number }>(
      `/api/v1/admin/${resource}?offset=0&limit=200`,
    )
      .then((result) => {
        if (alive.current) {
          setPage({ ...result, offset: result.items.length, ready: true });
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (alive.current) {
          setError(reason.message);
          setLoading(false);
        }
      });
    return () => {
      alive.current = false;
    };
  }, [resource]);
  const selected = (
    multiple ? (Array.isArray(value) ? value : []) : value ? [value] : []
  ).map(String);
  const selectedKey = JSON.stringify(selected);
  useEffect(() => {
    if (!page.ready) return;
    let live = true;
    const known = new Set([...page.items, ...extra].map((item) => item.id));
    const missing = selected.filter((id) => !known.has(id));
    if (!missing.length) return;
    void Promise.all(
      missing.map(async (id) => {
        try {
          return await api<DocumentDTO>(
            `/api/v1/admin/${resource}/${encodeURIComponent(id)}`,
          );
        } catch {
          return { id, name: `${id} (불러오지 못함)` } as DocumentDTO;
        }
      }),
    ).then((items) => {
      if (live) setExtra((previous) => [...previous, ...items]);
    });
    return () => {
      live = false;
    };
  }, [resource, selectedKey, page.ready, page.items, extra]);
  const options = new Map(
    [...page.items, ...extra].map((item) => [item.id, item]),
  );
  selected.forEach((id) => {
    if (!options.has(id)) options.set(id, { id, name: id } as DocumentDTO);
  });
  async function more() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: DocumentDTO[]; total: number }>(
        `/api/v1/admin/${resource}?offset=${page.offset}&limit=200`,
      );
      if (alive.current)
        setPage((previous) => ({
          items: [...previous.items, ...result.items],
          offset: previous.offset + result.items.length,
          total: result.total,
          ready: true,
        }));
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return (
    <>
      <select
        id={id}
        required={required}
        multiple={multiple}
        value={multiple ? selected : String(value ?? "")}
        onChange={(event) =>
          change(
            multiple
              ? Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                )
              : event.target.value,
          )
        }
      >
        {!multiple && <option value="">선택하세요</option>}
        {[...options.values()].map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.id}
          </option>
        ))}
      </select>
      {page.offset < page.total && (
        <button type="button" disabled={loading} onClick={() => void more()}>
          선택지 더 불러오기 ({page.offset}/{page.total})
        </button>
      )}
      {loading && <small role="status">선택지를 불러오는 중…</small>}
      {error && <small role="alert">{error}</small>}
    </>
  );
}
export function formBody(
  fields: FieldSpec[],
  draft: DocumentDTO | Record<string, unknown>,
) {
  return Object.fromEntries(
    fields
      .filter(
        (f) =>
          !f.readonly &&
          draft[f.name] !== undefined &&
          !(f.secret && draft[f.name] === ""),
      )
      .map((f) => [
        f.name,
        f.type === "json" && typeof draft[f.name] === "string"
          ? JSON.parse(draft[f.name] as string)
          : draft[f.name],
      ]),
  );
}
