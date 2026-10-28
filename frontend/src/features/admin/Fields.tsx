import { useApi } from "../../app/ui";
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
  const refs = useApi<{ items: DocumentDTO[] }>(
    field.reference ? `/api/v1/admin/${field.reference}?limit=200` : undefined,
  );
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
    const multiple = field.type === "reference-list";
    input = (
      <select
        id={id}
        required={required}
        multiple={multiple}
        value={
          multiple
            ? Array.isArray(value)
              ? (value as string[])
              : []
            : String(value ?? "")
        }
        onChange={(e) =>
          change(
            multiple
              ? Array.from(e.target.selectedOptions, (o) => o.value)
              : e.target.value,
          )
        }
      >
        {!multiple && <option value="">선택하세요</option>}
        {refs.data?.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.id}
          </option>
        ))}
      </select>
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
