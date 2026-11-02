import { useI18n } from "../../app/i18n";
import { displayError } from "../../app/error-message";
import { api, ApiError } from "../../api/client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { loadAFrame } from "../../scene/mountRoom";
import { evaluateFlame, loadFlameModel } from "../../avatar/flame-runtime";
import { gaussianEyePose } from "../../avatar/gaussian-eye-pose";
import type { GazeSnapshot } from "../../avatar/gaze";

const BASE = "/api/v1/dev/gaussian-avatar/";
export type NativeDisplayState = {
  subject: "306";
  sourceRevision: string;
  pose: "canonical";
  yaw: number;
  pitch: number;
  jawDeltaDegrees: number;
  expression0Delta: number;
  orbitDegrees: number;
  zoom: number;
};

/** Actual private subject-306 geometry, driven by the same recorded lab output. */
export default function NativeGaussianPreview({
  gaze,
  appliedState,
  summary,
  targetLabel,
  targetColor,
}: {
  gaze: RefObject<GazeSnapshot | null>;
  appliedState: RefObject<NativeDisplayState | null>;
  summary: GazeSnapshot | null;
  targetLabel: string;
  targetColor: string;
}) {
  const { t } = useI18n();
  const eyeId = useId();
  const selected = summary?.scores.find(
    (score) => score.id === summary.targetId,
  );
  const yaw = summary?.yaw ?? 0,
    pitch = summary?.pitch ?? 0;
  const host = useRef<HTMLDivElement>(null);
  const [modelInfo, setModelInfo] = useState<{
    gaussians: number;
    vertices: number;
  } | null>(null);
  const [access, setAccess] = useState<'loading' | 'locked' | 'unavailable' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0), [pin, setPin] = useState(''), [unlocking, setUnlocking] = useState(false);
  const [protectedPreview, setProtectedPreview] = useState(false);
  const [error, setError] = useState<[string, string] | null>(null),
    [jaw, setJaw] = useState(0),
    [expression, setExpression] = useState(0);
  const [orbit, setOrbit] = useState(0),
    [zoom, setZoom] = useState(1);
  const controls = useRef({ jaw, expression, orbit, zoom });
  controls.current = { jaw, expression, orbit, zoom };
  useEffect(() => {
    const abort = new AbortController();
    let renderer: any,
      avatar: any,
      frame = 0;
    const element = host.current!;
    setAccess('loading'); setError(null); setModelInfo(null);
    const fail = (reason: unknown) => {
      if (!abort.signal.aborted) {
        const message =
          reason instanceof Error ? reason.message : String(reason);
        setError([message, message]);
        setAccess('error');
      }
    };
    void (async () => {
      const ready = await fetch(`${BASE}status`, { signal: abort.signal });
      const status = ready.ok ? await ready.json() : null;
      if (abort.signal.aborted) return;
      if (!status?.ready) {
        setAccess(status?.scope === 'password_required' ? 'locked' : 'unavailable');
        return;
      }
      setProtectedPreview(status.scope === 'password_protected');
      await loadAFrame();
      if (abort.signal.aborted) return;
      const THREE = (window as any).AFRAME.THREE;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#dce4e8");
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.domElement.style.cssText =
        "width:100%;height:420px;display:block;";
      element.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 20);
      const model = await loadFlameModel(`${BASE}manifest.json`, {
        signal: abort.signal,
      });
      const moduleUrl = new URL("/vendor/gaussian-avatar-native.js", location.origin).href;
      const { createNativeGaussianAvatar } = await import(
        /* @vite-ignore */ moduleUrl
      );
      const vertices = evaluateFlame(model, {
        rotation: [0, 0, 0],
        neck: [0, 0, 0],
        translation: [0, 0, 0],
        eyes: [0, 0, 0, 0, 0, 0],
      });
      avatar = await createNativeGaussianAvatar({
        scene,
        renderer,
        faces: model.faces,
        vertices,
        plyUrl: new URL(
          model.manifest.gaussian.file,
          new URL(`${BASE}manifest.json`, location.href),
        ).href,
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        avatar.dispose();
        return;
      }
      avatar.root.updateMatrixWorld(true);
      const bound = avatar.bounds.clone().applyMatrix4(avatar.root.matrixWorld);
      const center = bound.getCenter(new THREE.Vector3()),
        size = bound.getSize(new THREE.Vector3());
      const distance =
        (Math.max(size.x, size.y, size.z) /
          (2 * Math.tan((camera.fov * Math.PI) / 360))) *
        1.1;
      setAccess('ready');
      element.dataset.gaussians = String(avatar.count);
      setModelInfo({
        gaussians: avatar.count,
        vertices: model.manifest.vertexCount,
      });
      let applied = -Infinity,
        lastKey = "",
        width = 0;
      const draw = (time: number) => {
        if (abort.signal.aborted) return;
        const c = controls.current;
        if (time - applied >= 50 && document.visibilityState !== "hidden") {
          const output = gaze.current;
          const yaw = output?.yaw ?? 0,
            pitch = output?.pitch ?? 0;
          const key = `${yaw.toFixed(4)},${pitch.toFixed(4)},${c.jaw},${c.expression}`;
          if (key !== lastKey) {
            const eyes = gaussianEyePose(yaw, pitch);
            const expr = Array.from(model.defaultParameters.expression);
            expr[0] += c.expression;
            const jawPose = Array.from(model.defaultParameters.jaw);
            jawPose[0] += (c.jaw * Math.PI) / 180;
            const posed = evaluateFlame(model, {
              expression: expr,
              jaw: jawPose,
              eyes,
              rotation: [0, 0, 0],
              neck: [0, 0, 0],
              translation: [0, 0, 0],
            });
            avatar.updateVertices(posed);
            lastKey = key;
            element.dataset.yaw = String(yaw);
            element.dataset.pitch = String(pitch);
            element.dataset.poseUpdates = String(
              Number(element.dataset.poseUpdates ?? 0) + 1,
            );
            appliedState.current = {
              subject: "306",
              sourceRevision: model.manifest.sourceRevision,
              pose: "canonical",
              yaw,
              pitch,
              jawDeltaDegrees: c.jaw,
              expression0Delta: c.expression,
              orbitDegrees: c.orbit,
              zoom: c.zoom,
            };
          }
          applied = time;
        }
        const nextWidth = element.clientWidth || 600;
        if (width !== nextWidth) {
          width = nextWidth;
          renderer.setSize(width, 420, false);
          camera.aspect = width / 420;
          camera.updateProjectionMatrix();
        }
        const angle = (c.orbit * Math.PI) / 180,
          radius = distance * c.zoom;
        camera.position.set(
          center.x + Math.sin(angle) * radius,
          center.y + size.y * 0.05,
          center.z - Math.cos(angle) * radius,
        );
        camera.lookAt(center);
        if (appliedState.current)
          appliedState.current = {
            ...appliedState.current,
            orbitDegrees: c.orbit,
            zoom: c.zoom,
          };
        renderer.render(scene, camera);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    })().catch(fail);
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      avatar?.dispose();
      appliedState.current = null;
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [gaze, appliedState, attempt]);
  return (
    <section
      className="gaze-panel gaze-scene"
      aria-label={t(
        "네이티브 GaussianAvatars 미리보기",
        "Native GaussianAvatars preview",
      )}
    >
      <h2>{t("네이티브 GaussianAvatars", "Native GaussianAvatars")}</h2>
      <p className="gaze-help">
        {t(
          "공식 306 샘플의 학습된 Gaussian을 실제 FLAME 삼각형에 결합해 렌더링합니다. 위 실험과 같은 시선 출력을 눈 관절에 적용합니다. 정렬된 머리 자세를 사용하며 카메라 회전은 시선 계산에 영향을 주지 않습니다.",
          "Renders the trained Gaussians from official sample 306 attached to actual FLAME triangles. The eye joints use the same gaze output as the experiment above. The head pose is aligned; camera rotation does not affect gaze calculations.",
        )}
      </p>
      <div className="gaze-native-layout">
        <aside
          className="gaze-native-reference"
          aria-label={t(
            "아바타와 함께 보는 시선 도식",
            "Gaze diagram alongside the avatar",
          )}
        >
          <h3>{t("눈 회전 도식", "Eye rotation diagram")}</h3>
          <svg
            className="gaze-native-eyes"
            viewBox="0 0 356 390"
            role="img"
            aria-label={t(
              "Gaussian 아바타와 같은 시선 방향을 보여주는 눈 회전 도식",
              "Eye rotation diagram showing the same gaze direction as the Gaussian avatar",
            )}
          >
            <ellipse cx="178" cy="190" rx="129" ry="156" fill="#e3e9df" />
            {[126, 230].map((x, index) => (
              <g key={x}>
                <defs>
                  <clipPath id={`${eyeId}-${index}`}>
                    <ellipse cx={x} cy="161" rx="37" ry="24" />
                  </clipPath>
                </defs>
                <ellipse
                  cx={x}
                  cy="161"
                  rx="37"
                  ry="24"
                  fill="white"
                  stroke="#98aaa0"
                  strokeWidth="2"
                />
                <g clipPath={`url(#${eyeId}-${index})`}>
                  <circle
                    cx={x - Math.sin(yaw) * 29}
                    cy={161 - Math.sin(pitch) * 29}
                    r="13"
                    fill="#477274"
                  />
                  <circle
                    cx={x - Math.sin(yaw) * 29}
                    cy={161 - Math.sin(pitch) * 29}
                    r="6"
                    fill="#173b3e"
                  />
                </g>
              </g>
            ))}
            <path
              d="M178 182 l-11 44 h21 M151 266 Q178 276 205 266"
              fill="none"
              stroke="#a4b4a6"
              strokeWidth="3"
            />
          </svg>
          <div
            className="gaze-native-target"
            data-gaze-target={summary?.targetId ?? ""}
          >
            <span className="gaze-help">
              {t("현재 타겟", "Current target")}
            </span>
            <strong>
              <span aria-hidden="true" style={{ color: targetColor }}>
                ●
              </span>{" "}
              {targetLabel}
            </strong>
            <dl>
              <div>
                <dt>{t("거리", "Distance")}</dt>
                <dd>{selected ? `${selected.distance.toFixed(2)} m` : "—"}</dd>
              </div>
              <div>
                <dt>{t("중심 각도", "Angle from center")}</dt>
                <dd>
                  {selected ? `${selected.angleDegrees.toFixed(1)}°` : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("점수", "Score")}</dt>
                <dd>{selected?.score.toFixed(3) ?? "—"}</dd>
              </div>
            </dl>
          </div>
          <div className="gaze-native-angles">
            <span>
              yaw <strong>{((yaw * 180) / Math.PI).toFixed(1)}°</strong>
            </span>
            <span>
              pitch <strong>{((pitch * 180) / Math.PI).toFixed(1)}°</strong>
            </span>
          </div>
        </aside>
        <div
          ref={host}
          className="gaze-native-canvas"
          data-native-avatar-state={access}
        />
      </div>
      <p role="status">
        {modelInfo
          ? t(
              "GaussianAvatars 306 · Gaussian {gaussians}개 · FLAME 정점 {vertices}개",
              "GaussianAvatars 306 · {gaussians} Gaussians · FLAME {vertices} vertices",
              {
                gaussians: modelInfo.gaussians.toLocaleString(),
                vertices: modelInfo.vertices.toLocaleString(),
              },
            )
          : access === 'locked' ? t('임시 비밀번호를 입력하면 모델을 불러옵니다.', 'Enter the temporary password to load the model.')
          : access === 'unavailable' ? t('이 서버에서는 모델을 사용할 수 없습니다. 시선 도식과 실험 설정은 계속 사용할 수 있습니다.', 'The model is not available on this server. The gaze diagram and experiment controls remain available.')
          : access === 'error' ? t('모델을 불러오지 못했습니다. 다시 시도해 주세요.', 'The model could not load. Please retry.')
          : t(
              "로컬 GaussianAvatars 모델을 불러오는 중…",
              "Loading local GaussianAvatars model…",
            )}
      </p>
      {access === 'locked' && <form className="gaze-fields" onSubmit={event => {
        event.preventDefault();
        if (unlocking) return;
        setUnlocking(true); setError(null);
        void api(`${BASE}unlock`, { method: 'POST', body: JSON.stringify({ pin }) }).then(() => {
          setAttempt(value => value + 1);
        }).catch(reason => {
          setError(reason instanceof ApiError && reason.status === 429
            ? ['입력 시도가 많습니다. 5분 뒤 다시 시도하세요.', 'Too many attempts. Try again in five minutes.']
            : ['인증하지 못했습니다. 비밀번호와 연결을 확인하세요.', 'Unable to unlock. Check the password and connection.']);
        }).finally(() => { setPin(''); setUnlocking(false); });
      }}>
        <label>{t('임시 비밀번호', 'Temporary password')}<input type="password" autoComplete="current-password"
          minLength={4} maxLength={128} required value={pin} onChange={event => setPin(event.target.value)} disabled={unlocking} /></label>
        <button disabled={unlocking} type="submit">{t('미리보기 열기', 'Unlock preview')}</button>
      </form>}
      {access === 'error' && <button onClick={() => setAttempt(value => value + 1)}>{t('다시 시도', 'Retry')}</button>}
      {protectedPreview && access === 'ready' && <button onClick={() => {
        void api(`${BASE}unlock`, { method: 'DELETE' }).then(() => setAttempt(value => value + 1))
          .catch(() => setError(['잠그지 못했습니다. 연결을 확인하세요.', 'Unable to lock. Check the connection.']));
      }}>{t('미리보기 잠그기', 'Lock preview')}</button>}
      {error && <p role="alert">{displayError(t(...error))}</p>}
      <div className="gaze-fields">
        <label>
          {t("카메라 회전 · {angle}°", "Camera orbit · {angle}°", {
            angle: orbit,
          })}
          <input
            aria-label={t("네이티브 카메라 회전", "Native camera orbit")}
            disabled={!modelInfo}
            type="range"
            min="-70"
            max="70"
            value={orbit}
            onChange={(e) => setOrbit(+e.target.value)}
          />
        </label>
        <label>
          {t("확대 · {zoom}", "Zoom · {zoom}", { zoom: zoom.toFixed(1) })}
          <input
            aria-label={t("네이티브 카메라 확대", "Native camera zoom")}
            disabled={!modelInfo}
            type="range"
            min=".6"
            max="1.6"
            step=".1"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <label>
          {t("턱 회전 추가 · {angle}°", "Additional jaw rotation · {angle}°", {
            angle: jaw,
          })}
          <input
            aria-label={t("네이티브 턱", "Native jaw")}
            disabled={!modelInfo}
            type="range"
            min="0"
            max="20"
            value={jaw}
            onChange={(e) => setJaw(+e.target.value)}
          />
        </label>
        <label>
          {t(
            "표현 계수 0 추가 · {expression}",
            "Additional expression coefficient 0 · {expression}",
            { expression: expression.toFixed(1) },
          )}
          <input
            aria-label={t("네이티브 표현", "Native expression")}
            disabled={!modelInfo}
            type="range"
            min="-2"
            max="2"
            step=".1"
            value={expression}
            onChange={(e) => setExpression(+e.target.value)}
          />
        </label>
      </div>
      <p className="gaze-help">
        {t(
          "로컬 연구용 공식 샘플입니다. 기록에는 적용된 눈·턱·표현 값과 모델 리비전도 포함되며, 화면 영상은 포함하지 않습니다.",
          "Official sample for local research. Recordings include applied eye, jaw and expression values and the model revision; rendered video is not included.",
        )}
      </p>
    </section>
  );
}
