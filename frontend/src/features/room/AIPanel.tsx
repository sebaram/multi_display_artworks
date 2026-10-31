import { localizeRoomMessage } from "./messages";
import { useI18n } from "../../app/i18n";
import { useState } from "react";
import { write } from "../../api/client";
import { Status } from "../../app/ui";
export default function AIPanel({
  roomId,
  onPreview,
  onApplied,
  onClose,
}: {
  roomId: string;
  onPreview: (arrangements: any[]) => void;
  onApplied: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(""),
    [draft, setDraft] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  async function request(mode: "layout" | "effect") {
    setBusy(true);
    setError("");
    try {
      const result = await write(`/api/auto-${mode}`, "POST", {
        room_id: roomId,
        prompt,
      });
      if (mode === "layout") {
        setDraft(result);
        onPreview(result.arrangements || []);
        setStatus(
          t("배치 제안을 미리 보고 있습니다. 적용하려면 아래 버튼을 누르세요.", "Previewing a layout suggestion. Use the button below to apply it."),
        );
      } else setStatus(t("효과를 적용했습니다.", "Effect applied."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="inspector ai-inspector">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t("큐레이터 도우미", "CURATOR ASSISTANT")}</div>
          <h2>{t("AI 큐레이션", "AI curation")}</h2>
        </div>
        <button aria-label={t("AI 패널 닫기", "Close AI panel")} onClick={onClose}>
          ×
        </button>
      </div>
      <label>
        {t("작품 배치나 공간 효과 요청", "Request an artwork layout or spatial effect")}
        <textarea
          rows={5}
          value={prompt}
          placeholder={t("예: 비슷한 색의 작품을 같은 월에 모아 주세요", "Example: Group artworks with similar colors on the same wall")}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button
          disabled={busy || !prompt.trim()}
          onClick={() => void request("layout")}
        >
          {t("배치 제안", "Suggest layout")}
        </button>
        <button
          disabled={busy || !prompt.trim()}
          onClick={() => void request("effect")}
        >
          {t("효과 만들기", "Create effect")}
        </button>
      </div>
      <Status loading={busy} error={localizeRoomMessage(error)} />
      {status && (
        <p role="status" className="notice">
          {localizeRoomMessage(status)}
        </p>
      )}
      {draft && (
        <>
          <p>{draft.explanation}</p>
          <ul>
            {draft.arrangements?.map((a: any) => (
              <li key={a.element_id}>
                {a.wall_name} · X {a.position_x}, Y {a.position_y}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await write("/api/apply-layout", "POST", {
                  room_id: roomId,
                  arrangements: draft.arrangements,
                });
                await onApplied();
                setStatus(t("배치를 저장했습니다.", "Layout saved."));
                setDraft(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("제안한 배치 저장·적용", "Save and apply suggested layout")}
          </button>
        </>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          try {
            await write("/api/clear-effects", "POST", { room_id: roomId });
            setStatus(t("효과를 해제했습니다.", "Effects cleared."));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {t("효과 해제", "Clear effects")}
      </button>
      <p className="muted">{t("API 오류가 발생해도 요청과 제안은 유지됩니다.", "Your request and suggestions are kept if an API error occurs.")}</p>
    </aside>
  );
}
