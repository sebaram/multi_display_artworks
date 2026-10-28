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
  onApplied: () => void;
  onClose: () => void;
}) {
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
          "배치 제안을 미리 보고 있습니다. 적용하려면 아래 버튼을 누르세요.",
        );
      } else setStatus("효과를 적용했습니다.");
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
          <div className="eyebrow">CURATOR ASSISTANT</div>
          <h2>AI 큐레이션</h2>
        </div>
        <button aria-label="AI 패널 닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <label>
        작품 배치나 공간 효과 요청
        <textarea
          rows={5}
          value={prompt}
          placeholder="예: 비슷한 색의 작품을 같은 월에 모아 주세요"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button
          disabled={busy || !prompt.trim()}
          onClick={() => void request("layout")}
        >
          배치 제안
        </button>
        <button
          disabled={busy || !prompt.trim()}
          onClick={() => void request("effect")}
        >
          효과 만들기
        </button>
      </div>
      <Status loading={busy} error={error} />
      {status && (
        <p role="status" className="notice">
          {status}
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
                onApplied();
                setStatus("배치를 저장했습니다.");
                setDraft(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            제안한 배치 저장·적용
          </button>
        </>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          try {
            await write("/api/clear-effects", "POST", { room_id: roomId });
            setStatus("효과를 해제했습니다.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        효과 해제
      </button>
      <p className="muted">API 오류가 발생해도 요청과 제안은 유지됩니다.</p>
    </aside>
  );
}
