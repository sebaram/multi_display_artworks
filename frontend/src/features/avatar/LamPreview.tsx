import { useEffect, useRef, useState, type RefObject } from "react";
import { api, ApiError } from "../../api/client";
import { useI18n } from "../../app/i18n";
import type { GazeSnapshot } from "../../avatar/gaze";
import { lamEyeWeights } from "../../avatar/lam-gaze";

const BASE = "/api/v1/dev/lam-avatar/";
export type LamDisplayState = {
  format: "lam-arkit-v1";
  sourceRevision: string;
  packageSha256: string;
  yaw: number;
  pitch: number;
  yawDegrees: number;
  pitchDegrees: number;
  jawOpen: number;
  weights: ReturnType<typeof lamEyeWeights>;
};
type Manifest = {
  sourceRevision: string;
  packageSha256: string;
  gaussians: number;
};

export default function LamPreview({
  gaze,
  appliedState,
  summary,
  targetLabel,
}: {
  gaze: RefObject<GazeSnapshot | null>;
  appliedState: RefObject<LamDisplayState | null>;
  summary: GazeSnapshot | null;
  targetLabel: string;
}) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState("loading"),
    [attempt, setAttempt] = useState(0);
  const [manifest, setManifest] = useState<Manifest>();
  const [pin, setPin] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [yawDegrees, setYawDegrees] = useState(25),
    [pitchDegrees, setPitchDegrees] = useState(15),
    [jawOpen, setJawOpen] = useState(0);
  const [protectedPreview, setProtectedPreview] = useState(false);
  const controls = useRef({ yawDegrees, pitchDegrees, jawOpen });
  controls.current = { yawDegrees, pitchDegrees, jawOpen };
  useEffect(() => {
    const abort = new AbortController();
    setPhase("loading");
    setError("");
    setManifest(undefined);
    void api(`${BASE}status`, { signal: abort.signal })
      .then(async (status) => {
        if (abort.signal.aborted) return;
        if (!status.ready) {
          setPhase(
            status.scope === "password_required" ? "locked" : "unavailable",
          );
          return;
        }
        const data = await api<Manifest>(`${BASE}manifest.json`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setManifest(data);
        setProtectedPreview(status.scope === "password_protected");
        setPhase("model");
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setPhase("error");
          setError(String(reason.message));
        }
      });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "lam-ready") setPhase("ready");
      if (event.data?.type === "lam-error") {
        setPhase("error");
        setError(String(event.data.detail));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (phase !== "model" && phase !== "ready") return;
    const timer = window.setInterval(() => {
      const { yaw = 0, pitch = 0 } = gaze.current ?? {};
      const c = controls.current;
      frame.current?.contentWindow?.postMessage(
        { type: "lam-gaze", yaw, pitch, ...c },
        location.origin,
      );
      if (phase === "ready" && manifest)
        appliedState.current = {
          format: "lam-arkit-v1",
          sourceRevision: manifest.sourceRevision,
          packageSha256: manifest.packageSha256,
          yaw,
          pitch,
          ...c,
          weights: lamEyeWeights(yaw, pitch, c.yawDegrees, c.pitchDegrees),
        };
    }, 50);
    const timeout =
      phase === "model"
        ? window.setTimeout(() => {
            setPhase("error");
            setError("LAM renderer timed out");
          }, 60000)
        : undefined;
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
      appliedState.current = null;
    };
  }, [phase, manifest, gaze, appliedState]);
  const showing = phase === "model" || phase === "ready";
  return (
    <section
      className="gaze-panel gaze-scene"
      aria-label={t("LAM 아바타 미리보기", "LAM avatar preview")}
    >
      <h2>LAM</h2>
      <p className="gaze-help">
        {t(
          "사진에서 생성한 3D 머리에 같은 절차적 시선을 적용합니다. 실제 눈 추적 데이터가 아닙니다.",
          "Applies the same procedural gaze to a 3D head generated from a photo. This is not eye tracking data.",
        )}
      </p>
      <div className="gaze-native-layout">
        <aside className="gaze-native-reference">
          <h3>{t("눈 회전 도식", "Eye rotation diagram")}</h3>
          <svg
            viewBox="0 0 320 240"
            role="img"
            aria-label={t("LAM 시선 방향 도식", "LAM gaze direction diagram")}
          >
            <ellipse cx="160" cy="120" rx="110" ry="110" fill="#e3e9df" />
            {[113, 207].map((x) => (
              <g key={x}>
                <ellipse cx={x} cy="105" rx="32" ry="23" fill="white" />
                <circle
                  cx={x - Math.sin(summary?.yaw ?? 0) * 25}
                  cy={105 - Math.sin(summary?.pitch ?? 0) * 25}
                  r="12"
                  fill="#477274"
                />
              </g>
            ))}
          </svg>
          <strong>
            {t("현재 타겟", "Current target")}: {targetLabel}
          </strong>
          <p>
            yaw {(((summary?.yaw ?? 0) * 180) / Math.PI).toFixed(1)}° · pitch{" "}
            {(((summary?.pitch ?? 0) * 180) / Math.PI).toFixed(1)}°
          </p>
        </aside>
        <div className="gaze-native-canvas" data-lam-avatar-state={phase}>
          {showing && (
            <iframe
              ref={frame}
              src="/lam-preview.html"
              title={t("LAM 3D 렌더러", "LAM 3D renderer")}
              style={{
                width: "100%",
                height: 420,
                border: 0,
                display: "block",
              }}
            />
          )}
        </div>
      </div>
      <p role="status">
        {phase === "ready"
          ? t(
              "LAM 아바타 준비됨 · Gaussian {count}개",
              "LAM avatar ready · {count} Gaussians",
              { count: manifest?.gaussians ?? 0 },
            )
          : phase === "locked"
            ? t(
                "임시 비밀번호를 입력해 주세요.",
                "Enter the temporary password.",
              )
            : phase === "unavailable"
              ? t(
                  "이 서버에 생성된 LAM 아바타가 없습니다.",
                  "No generated LAM avatar is available on this server.",
                )
              : phase === "error"
                ? t(
                    "LAM 아바타를 불러오지 못했습니다.",
                    "Could not load the LAM avatar.",
                  )
                : t("LAM 아바타를 불러오는 중…", "Loading LAM avatar…")}
      </p>
      {phase === "locked" && (
        <form
          className="gaze-fields"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            void api(`${BASE}unlock`, {
              method: "POST",
              body: JSON.stringify({ pin }),
            })
              .then(() => setAttempt((value) => value + 1))
              .catch((reason) =>
                setError(
                  reason instanceof ApiError && reason.status === 429
                    ? "rate"
                    : "password",
                ),
              )
              .finally(() => {
                setPin("");
                setBusy(false);
              });
          }}
        >
          <label>
            {t("임시 비밀번호", "Temporary password")}
            <input
              type="password"
              autoComplete="current-password"
              minLength={4}
              maxLength={128}
              required
              value={pin}
              disabled={busy}
              onChange={(event) => setPin(event.target.value)}
            />
          </label>
          <button disabled={busy}>
            {t("미리보기 열기", "Unlock preview")}
          </button>
        </form>
      )}
      {error && (
        <p role="alert">
          {error === "rate"
            ? t(
                "입력 시도가 많습니다. 5분 뒤 다시 시도하세요.",
                "Too many attempts. Try again in five minutes.",
              )
            : error === "password"
              ? t(
                  "비밀번호와 연결을 확인하세요.",
                  "Check the password and connection.",
                )
              : error}
        </p>
      )}
      {phase === "error" && (
        <button onClick={() => setAttempt((value) => value + 1)}>
          {t("다시 시도", "Retry")}
        </button>
      )}
      {protectedPreview && phase === "ready" && (
        <button
          onClick={() => {
            void api(`${BASE}unlock`, { method: "DELETE" })
              .then(() => setAttempt((value) => value + 1))
              .catch((reason) => setError(reason.message));
          }}
        >
          {t("미리보기 잠그기", "Lock preview")}
        </button>
      )}
      <fieldset
        className="gaze-fields"
        disabled={phase !== "ready"}
        style={{ border: 0, padding: 0 }}
      >
        <label>
          {t("수평 최대 입력 각도", "Horizontal full-weight angle")}
          <input
            type="number"
            min="1"
            max="90"
            value={yawDegrees}
            onChange={(event) => setYawDegrees(event.target.valueAsNumber)}
          />
        </label>
        <label>
          {t("수직 최대 입력 각도", "Vertical full-weight angle")}
          <input
            type="number"
            min="1"
            max="90"
            value={pitchDegrees}
            onChange={(event) => setPitchDegrees(event.target.valueAsNumber)}
          />
        </label>
        <label>
          {t("입 벌림", "Jaw opening")}
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={jawOpen}
            onChange={(event) => setJawOpen(event.target.valueAsNumber)}
          />
        </label>
      </fieldset>
    </section>
  );
}
