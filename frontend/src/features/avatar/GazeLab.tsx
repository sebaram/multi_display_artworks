import { useI18n, translate } from "../../app/i18n";
import { displayError } from "../../app/error-message";
import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ChangeEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  createGazeController,
  DEFAULT_GAZE_CONFIG,
  GAZE_ALGORITHM_VERSION,
  normalizeGazeConfig,
  type GazeConfig,
  type GazeController,
  type GazeFrame,
  type GazeSnapshot,
  type GazeTarget,
} from "../../avatar/gaze";
import { GazeControls } from "./GazeControls";
import "./gaze-lab.css";
import type { NativeDisplayState } from "./NativeGaussianPreview";
const NativeGaussianPreview = lazy(() => import("./NativeGaussianPreview"));

const MAX_RECORDS = 1200;
const MAX_CONFIG_BYTES = 64 * 1024;
const DEG = Math.PI / 180;
type UiMessage = Parameters<typeof translate>;
function configError(reason: unknown): UiMessage {
  if (reason instanceof SyntaxError)
    return [
      "올바른 JSON 설정인지 확인하세요.",
      "Check that the JSON configuration is valid.",
    ];
  const text = reason instanceof Error ? reason.message : String(reason);
  const messages: Record<string, string> = {
    "Gaze configuration must be an object": "시선 설정은 객체여야 합니다.",
    "Unknown gaze configuration field": "알 수 없는 시선 설정 필드입니다.",
    "Unsupported gaze configuration version":
      "지원하지 않는 시선 설정 버전입니다.",
    "Invalid gaze mode": "시선 모드가 올바르지 않습니다.",
    "Gaze weights must be an object": "시선 가중치는 객체여야 합니다.",
    "Unknown gaze weight": "알 수 없는 시선 가중치입니다.",
    "Minimum fixation exceeds maximum fixation":
      "최소 응시 시간이 최대 응시 시간보다 깁니다.",
  };
  if (messages[text]) return [messages[text], text];
  const field = /^(Invalid|Out of range) gaze (weight )?(.+)$/.exec(text);
  if (field) {
    const [kind, weight, name] = field.slice(1);
    return kind === "Invalid"
      ? [
          weight
            ? "시선 가중치 {field} 값이 올바르지 않습니다."
            : "시선 설정 {field} 값이 올바르지 않습니다.",
          text,
          { field: name },
        ]
      : [
          weight
            ? "시선 가중치 {field} 값이 범위를 벗어났습니다."
            : "시선 설정 {field} 값이 범위를 벗어났습니다.",
          text,
          { field: name },
        ];
  }
  return [text, text];
}
type LabTarget = {
  id: string;
  label: string;
  kind: GazeTarget["kind"];
  color: string;
  angle: number;
  distance: number;
  elevation: number;
  visible: boolean;
  speaking: boolean;
  moving: boolean;
  interaction: number;
  salience: number;
};
type Scene = { headYaw: number; targets: LabTarget[] };
type RecordedSample = {
  frame: GazeFrame;
  gaze: GazeSnapshot;
  configIndex: number;
  nativeDisplay: NativeDisplayState | null;
};
type Recording = {
  samples: RecordedSample[];
  configChanges: Array<{ time: number; config: GazeConfig }>;
  lastConfig: GazeConfig | null;
  active: boolean;
  startedAt: string | null;
};
const INITIAL_SCENE: Scene = {
  headYaw: 0,
  targets: [
    {
      id: "person",
      label: "사람",
      kind: "person",
      color: "#a34a3c",
      angle: -18,
      distance: 5,
      elevation: 0,
      visible: true,
      speaking: false,
      moving: false,
      interaction: 0,
      salience: 0.4,
    },
    {
      id: "artwork",
      label: "작품",
      kind: "artwork",
      color: "#296b8a",
      angle: 22,
      distance: 6,
      elevation: 0.5,
      visible: true,
      speaking: false,
      moving: false,
      interaction: 0,
      salience: 0.7,
    },
    {
      id: "marker",
      label: "마커",
      kind: "marker",
      color: "#8a6a20",
      angle: 8,
      distance: 7,
      elevation: -0.4,
      visible: true,
      speaking: false,
      moving: true,
      interaction: 0,
      salience: 0.5,
    },
  ],
};

function targetLabel(target: LabTarget) {
  return translate(
    target.label,
    { person: "Person", artwork: "Artwork", marker: "Marker" }[target.kind],
  );
}

function makeFrame(scene: Scene, time: number, reset: boolean): GazeFrame {
  const halfYaw = (scene.headYaw * DEG) / 2;
  return {
    time,
    reset,
    head: {
      position: [0, 1.6, 0],
      orientation: [0, -Math.sin(halfYaw), 0, Math.cos(halfYaw)],
    },
    targets: scene.targets.map((target) => {
      const angle =
        (target.angle + (target.moving ? Math.sin(time / 1800) * 35 : 0)) * DEG;
      return {
        id: target.id,
        kind: target.kind,
        position: [
          Math.sin(angle) * target.distance,
          1.6 + target.elevation,
          -Math.cos(angle) * target.distance,
        ],
        visible: target.visible,
        speaking: target.speaking ? 1 : 0,
        interaction: target.interaction,
        motion: target.moving ? 1 : 0,
        salience: target.salience,
      };
    }),
  };
}

function drawDiagram(
  canvas: HTMLCanvasElement,
  scene: Scene,
  config: GazeConfig,
  frame: GazeFrame,
  gaze: GazeSnapshot,
) {
  const t = translate;
  const narrow = canvas.clientWidth < 520;
  const logicalWidth = narrow ? 620 : 1000,
    logicalHeight = narrow ? 1100 : 560;
  if (canvas.width !== logicalWidth || canvas.height !== logicalHeight) {
    canvas.width = logicalWidth;
    canvas.height = logicalHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width,
    height = canvas.height,
    cx = 310,
    cy = 306;
  const extent = Math.max(
    8,
    config.maxDistance,
    ...scene.targets.map((target) => target.distance),
  );
  const scale = 230 / extent,
    radius = config.maxDistance * scale;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f5f7f3";
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${narrow ? 19 : 15}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#566964";
  ctx.fillText(
    t("위에서 본 장면 · Y 위 / −Z 정면", "Top view · Y up / −Z forward"),
    24,
    32,
  );
  ctx.strokeStyle = "#e1e8e0";
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 3; ring++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (230 * ring) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const yaw = scene.headYaw * DEG;
  const start = yaw - Math.PI / 2 - (config.coneDegrees * DEG) / 2;
  const end = yaw - Math.PI / 2 + (config.coneDegrees * DEG) / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, end);
  ctx.closePath();
  ctx.fillStyle = "#2a797c17";
  ctx.fill();
  ctx.strokeStyle = "#87b2aa";
  ctx.stroke();
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(yaw) * radius, cy - Math.cos(yaw) * radius);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#657771";
  ctx.font = `${narrow ? 18 : 12}px "Segoe UI", sans-serif`;
  ctx.fillText(
    t("{distance} m · 전체 {angle}°", "{distance} m · full {angle}°", {
      distance: config.maxDistance,
      angle: config.coneDegrees,
    }),
    24,
    536,
  );
  frame.targets.forEach((target, index) => {
    const model = scene.targets[index],
      x = cx + target.position[0] * scale,
      y = cy + target.position[2] * scale;
    ctx.globalAlpha = target.visible ? 1 : 0.35;
    if (gaze.targetId === target.id) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = model.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = model.color;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${narrow ? 19 : 14}px "Segoe UI", sans-serif`;
    ctx.fillText(
      `${targetLabel(model)}${target.speaking ? t(" · 발화", " · speaking") : ""}${target.visible ? "" : t(" · 숨김", " · hidden")}`,
      x + 13,
      y - 11,
    );
    ctx.globalAlpha = 1;
  });
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(yaw);
  ctx.fillStyle = "#dae2d7";
  ctx.strokeStyle = "#3d6058";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 23, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-5, -25);
  ctx.lineTo(0, -35);
  ctx.lineTo(5, -25);
  ctx.stroke();
  ctx.strokeStyle = "#185b60";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.sin(gaze.yaw) * 55, -Math.cos(gaze.yaw) * 55);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  if (narrow) ctx.translate(-500, 540);
  ctx.fillStyle = "#fff";
  ctx.fillRect(624, 20, 356, 520);
  ctx.fillStyle = "#405a53";
  ctx.font = `${narrow ? 19 : 15}px "Segoe UI", sans-serif`;
  ctx.fillText(
    t("눈 회전 도식 · 정면에서 보기", "Eye rotation diagram · front view"),
    644,
    54,
  );
  ctx.fillStyle = "#e3e9df";
  ctx.beginPath();
  ctx.ellipse(802, 240, 129, 156, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const x of [750, 854]) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#98aaa0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, 211, 37, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // In a front view, the head's local +X appears on the viewer's left.
    const dx = -Math.sin(gaze.yaw) * 29,
      dy = -Math.sin(gaze.pitch) * 29;
    ctx.fillStyle = "#477274";
    ctx.beginPath();
    ctx.arc(x + dx, 211 + dy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#173b3e";
    ctx.beginPath();
    ctx.arc(x + dx, 211 + dy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#a4b4a6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(802, 232);
  ctx.lineTo(791, 276);
  ctx.lineTo(812, 276);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(775, 316);
  ctx.quadraticCurveTo(802, 326, 829, 316);
  ctx.stroke();
  ctx.font = `${narrow ? 19 : 14}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#405a53";
  ctx.fillText(
    `yaw ${(gaze.yaw / DEG).toFixed(1)}° · pitch ${(gaze.pitch / DEG).toFixed(1)}°`,
    659,
    435,
  );
  ctx.fillStyle = "#6a7a72";
  ctx.font = `${narrow ? 18 : 13}px "Segoe UI", sans-serif`;
  ctx.fillText(
    t("양쪽 눈에 동일한 방향을 적용", "Same direction applied to both eyes"),
    659,
    465,
  );
  ctx.fillText(
    t(
      "GaussianAvatars 모델 렌더가 아닙니다",
      "Not a GaussianAvatars model render",
    ),
    659,
    490,
  );
  ctx.restore();
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function GazeLab({ native = false }: { native?: boolean }) {
  const { t } = useI18n();
  const [config, setConfig] = useState(() =>
    normalizeGazeConfig(DEFAULT_GAZE_CONFIG),
  );
  const [scene, setScene] = useState<Scene>(INITIAL_SCENE);
  const [summary, setSummary] = useState<GazeSnapshot | null>(null);
  const [recording, setRecording] = useState(false),
    [count, setCount] = useState(0);
  const [message, setMessage] = useState<UiMessage | null>(null),
    [error, setError] = useState<UiMessage | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nativeGaze = useRef<GazeSnapshot | null>(null);
  const nativeDisplay = useRef<NativeDisplayState | null>(null);
  const [showNative, setShowNative] = useState(native);
  const controller = useRef<GazeController | null>(null);
  if (!controller.current) controller.current = createGazeController(config);
  const configRef = useRef(config),
    sceneRef = useRef(scene),
    origin = useRef(0),
    needsReset = useRef(true);
  const recordingRef = useRef<Recording>({
    samples: [],
    configChanges: [],
    lastConfig: null,
    active: false,
    startedAt: null,
  });

  useEffect(() => {
    let raf = 0,
      lastSummary = -Infinity;
    origin.current = performance.now();
    const animate = (now: number) => {
      const frame = makeFrame(
        sceneRef.current,
        Math.max(0, now - origin.current),
        needsReset.current,
      );
      needsReset.current = false;
      const gaze = controller.current!.step(frame);
      nativeGaze.current = gaze;
      if (canvas.current)
        drawDiagram(
          canvas.current,
          sceneRef.current,
          configRef.current,
          frame,
          gaze,
        );
      const log = recordingRef.current;
      if (log.active) {
        if (log.lastConfig !== configRef.current) {
          log.configChanges.push({
            time: frame.time,
            config: configRef.current,
          });
          log.lastConfig = configRef.current;
        }
        log.samples.push({
          frame,
          gaze,
          configIndex: log.configChanges.length - 1,
          nativeDisplay: nativeDisplay.current
            ? { ...nativeDisplay.current }
            : null,
        });
        if (log.samples.length >= MAX_RECORDS) {
          log.active = false;
          setRecording(false);
          setMessage([
            "1200 프레임에 도달해 기록을 중지했습니다. JSON으로 내보낼 수 있습니다.",
            "Recording stopped at 1200 frames. You can export it as JSON.",
          ]);
        }
      }
      if (now - lastSummary >= 100) {
        setSummary(gaze);
        setCount(log.samples.length);
        lastSummary = now;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const changeConfig = (value: GazeConfig) => {
    const next = normalizeGazeConfig(value, true);
    configRef.current = next;
    controller.current!.configure(next);
    needsReset.current = true;
    setConfig(next);
  };
  const changeScene = (next: Scene) => {
    sceneRef.current = next;
    setScene(next);
  };
  const patchTarget = (index: number, patch: Partial<LabTarget>) =>
    changeScene({
      ...scene,
      targets: scene.targets.map((target, i) =>
        i === index ? { ...target, ...patch } : target,
      ),
    });
  const reset = () => {
    recordingRef.current.active = false;
    setRecording(false);
    controller.current!.reset();
    origin.current = performance.now();
    needsReset.current = true;
    setMessage([
      "시간과 시선 상태를 초기화했습니다. 기존 기록은 내보내기 전까지 유지됩니다.",
      "Time and gaze state reset. Existing recordings remain available to export.",
    ]);
  };
  const toggleRecording = () => {
    const log = recordingRef.current;
    if (log.active) {
      log.active = false;
      setRecording(false);
      setCount(log.samples.length);
      setMessage(["로컬 기록을 중지했습니다.", "Local recording stopped."]);
    } else {
      recordingRef.current = {
        samples: [],
        configChanges: [],
        lastConfig: null,
        active: true,
        startedAt: new Date().toISOString(),
      };
      controller.current!.reset();
      origin.current = performance.now();
      needsReset.current = true;
      setCount(0);
      setRecording(true);
      setMessage([
        "새 기록을 시작했습니다. 이전 로컬 버퍼를 교체하고 시간·시선 상태를 초기화했습니다.",
        "Started a new recording, replaced the previous local buffer, and reset time and gaze state.",
      ]);
    }
  };
  async function importConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      if (file.size > MAX_CONFIG_BYTES) {
        setError([
          "설정 파일은 64 KiB 이하여야 합니다.",
          "The configuration file must be 64 KiB or smaller.",
        ]);
        return;
      }
      changeConfig(normalizeGazeConfig(JSON.parse(await file.text()), true));
      setMessage([
        "설정을 불러오고 시선 상태를 초기화했습니다.",
        "Configuration loaded and gaze state reset.",
      ]);
    } catch (reason) {
      setError(configError(reason));
    }
  }
  const exportRecording = () => {
    const log = recordingRef.current;
    if (!log.samples.length) return;
    downloadJson("gaze-recording.json", {
      format: "procedural-gaze-lab",
      version: 1,
      algorithmVersion: GAZE_ALGORITHM_VERSION,
      timeUnit: "milliseconds",
      angleUnit: "radians",
      distanceUnit: "meters",
      coordinates: {
        up: "+Y",
        forward: "-Z",
        quaternion: "XYZW",
        positiveYaw: "head-local +X",
        positivePitch: "head-local +Y",
      },
      startedAt: log.startedAt,
      exportedAt: new Date().toISOString(),
      maxRecords: MAX_RECORDS,
      config: log.configChanges[0].config,
      seed: log.configChanges[0].config.seed,
      configChanges: log.configChanges,
      samples: log.samples,
      note: "Local procedural diagram. Each frame contains engine inputs and solved output. Configure resets the controller; frame.reset records explicit resets.",
    });
    setMessage([
      "{count} 프레임의 로컬 기록을 내보냈습니다.",
      "Exported {count} frames of local recording.",
      { count: log.samples.length },
    ]);
  };
  const selectedTarget = scene.targets.find(
    (target) => target.id === summary?.targetId,
  );

  return (
    <main className="page gaze-lab">
      <Link to="/tools" className="gaze-back">
        {t("← 도구", "← Tools")}
      </Link>
      <header className="gaze-heading">
        <div>
          <div className="eyebrow">
            {t("절차적 시선 / 로컬 실험", "PROCEDURAL GAZE / LOCAL EXPERIMENT")}
          </div>
          <h1>{t("시선 실험실", "Gaze lab")}</h1>
          <p>
            {t(
              "대상 선택과 눈 회전의 규칙을 조정하고 같은 입력으로 실험을 재현합니다.",
              "Adjust target selection and eye rotation rules, and reproduce experiments with the same input.",
            )}
          </p>
        </div>
        <span className="gaze-version">{GAZE_ALGORITHM_VERSION}</span>
      </header>
      <div className="gaze-disclosure">
        <strong>{t("절차적 시선 도식", "Procedural gaze diagram")}</strong>
        {t(
          "· GaussianAvatars 샘플이나 눈 추적 데이터가 아닙니다. 아래에서 로컬 네이티브 GaussianAvatars도 같은 시선으로 확인할 수 있습니다. 자연스러움과 관찰자의 인지 여부는 검증 전 가설입니다.",
          "· This is not a GaussianAvatars sample or eye tracking data. Below, you can also view a local native GaussianAvatars model with the same gaze. Naturalness and observer awareness remain untested hypotheses.",
        )}
      </div>
      <div className="gaze-workspace">
        <section
          className="gaze-preview"
          aria-labelledby="gaze-diagram-heading"
        >
          <div className="gaze-section-heading">
            <h2 id="gaze-diagram-heading">
              {t("실시간 도식", "Live diagram")}
            </h2>
            <button type="button" onClick={reset}>
              {t("시간·시선 초기화", "Reset time and gaze")}
            </button>
          </div>
          <canvas
            ref={canvas}
            width="1000"
            height="560"
            aria-label={t(
              "머리와 눈, 시야각 원뿔, 사람·작품·마커를 표시한 절차적 시선 도식",
              "Procedural gaze diagram showing the head, eyes, view cone, person, artwork and marker",
            )}
            role="img"
          />
          <div
            className="gaze-readout"
            aria-label={t("현재 시선 상태", "Current gaze state")}
          >
            <span>
              {t("대상", "Target")}{" "}
              <strong>
                {selectedTarget
                  ? targetLabel(selectedTarget)
                  : t("정면", "Forward")}
              </strong>
            </span>
            <span>
              yaw <strong>{((summary?.yaw ?? 0) / DEG).toFixed(1)}°</strong>
            </span>
            <span>
              pitch <strong>{((summary?.pitch ?? 0) / DEG).toFixed(1)}°</strong>
            </span>
            <span>
              {t("시간", "Time")}{" "}
              <strong>{((summary?.time ?? 0) / 1000).toFixed(1)} s</strong>
            </span>
          </div>
          <p className="gaze-help">
            {t(
              "선택은 10 Hz, 평활화와 도식은 렌더 프레임마다 계산합니다. 수치·표는 최대 10 Hz로 갱신됩니다. 눈 회전은 head-local 각도입니다.",
              "Selection runs at 10 Hz; smoothing and diagrams update every render frame. Values and tables update at up to 10 Hz. Eye rotation uses head-local angles.",
            )}
          </p>
          <div className="gaze-table-wrap">
            <table className="gaze-score-table">
              <caption>
                {t(
                  "시야각·거리·가시성 검사를 통과한 대상",
                  "Targets passing the field of view, distance and visibility checks",
                )}
              </caption>
              <colgroup>
                <col style={{ width: "34%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{t("대상", "Target")}</th>
                  <th scope="col">{t("점수", "Score")}</th>
                  <th scope="col">{t("시야 중심 각도", "View angle")}</th>
                  <th scope="col">{t("거리", "Distance")}</th>
                </tr>
              </thead>
              <tbody>
                {summary?.scores.length ? (
                  summary.scores.map((score) => (
                    <tr
                      key={score.id}
                      className={
                        summary.targetId === score.id ? "is-selected" : ""
                      }
                    >
                      <th scope="row">
                        {score.id}
                        {summary.targetId === score.id
                          ? t(" · 선택", " · selected")
                          : ""}
                      </th>
                      <td>{score.score.toFixed(3)}</td>
                      <td>{score.angleDegrees.toFixed(1)}°</td>
                      <td>{score.distance.toFixed(2)} m</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>
                      {t(
                        "조건을 통과한 대상이 없습니다.",
                        "No targets pass the checks.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="gaze-panel" aria-labelledby="gaze-config-heading">
          <h2 id="gaze-config-heading">{t("시선 설정", "Gaze settings")}</h2>
          <GazeControls config={config} onChange={changeConfig} />
        </aside>
      </div>
      <div className="gaze-actions gaze-scene">
        <button type="button" onClick={() => setShowNative(!showNative)}>
          {showNative
            ? t("GaussianAvatars 닫기", "Close GaussianAvatars")
            : t("로컬 GaussianAvatars 열기", "Open local GaussianAvatars")}
        </button>
      </div>
      {showNative && (
        <Suspense
          fallback={
            <p role="status">
              {t("네이티브 렌더러 로딩 중…", "Loading native renderer…")}
            </p>
          }
        >
          <NativeGaussianPreview
            gaze={nativeGaze}
            appliedState={nativeDisplay}
            summary={summary}
            targetLabel={
              selectedTarget
                ? targetLabel(selectedTarget)
                : t("정면", "Forward")
            }
            targetColor={selectedTarget?.color ?? "#185b60"}
          />
        </Suspense>
      )}
      <section
        className="gaze-panel gaze-scene"
        aria-labelledby="gaze-scene-heading"
      >
        <div className="gaze-section-heading">
          <div>
            <h2 id="gaze-scene-heading">{t("장면 입력", "Scene inputs")}</h2>
            <p className="gaze-help">
              {t(
                "마이크·카메라 입력 없이 수동 신호를 사용합니다. 움직임은 기준 각도 ±35°의 결정적 진동입니다.",
                "Uses manual signals without microphone or camera input. Motion is a deterministic oscillation of ±35° around the base angle.",
              )}
            </p>
          </div>
          <label>
            {t("머리 yaw · {angle}°", "Head yaw · {angle}°", {
              angle: scene.headYaw,
            })}
            <input
              aria-label={t("머리 yaw", "Head yaw")}
              type="range"
              min="-180"
              max="180"
              step="1"
              value={scene.headYaw}
              onChange={(event) =>
                changeScene({ ...scene, headYaw: event.target.valueAsNumber })
              }
            />
          </label>
        </div>
        <div className="gaze-target-grid">
          {scene.targets.map((target, index) => (
            <fieldset key={target.id} className="gaze-target">
              <legend>
                <span style={{ color: target.color }}>●</span>{" "}
                {targetLabel(target)}
              </legend>
              <label>
                {t("기준 방향 · {angle}°", "Base direction · {angle}°", {
                  angle: target.angle,
                })}
                <input
                  aria-label={t("{name} 방향", "{name} direction", {
                    name: targetLabel(target),
                  })}
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={target.angle}
                  onChange={(event) =>
                    patchTarget(index, { angle: event.target.valueAsNumber })
                  }
                />
              </label>
              <div className="gaze-fields">
                <label>
                  {t("거리 (m)", "Distance (m)")}
                  <input
                    aria-label={t("{name} 거리", "{name} distance", {
                      name: targetLabel(target),
                    })}
                    type="number"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={target.distance}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        patchTarget(index, {
                          distance: Math.max(0.5, Math.min(20, value)),
                        });
                    }}
                  />
                </label>
                <label>
                  {t("눈높이 차 (m)", "Eye height difference (m)")}
                  <input
                    aria-label={t("{name} 높이", "{name} height", {
                      name: targetLabel(target),
                    })}
                    type="number"
                    min="-3"
                    max="3"
                    step="0.1"
                    value={target.elevation}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        patchTarget(index, {
                          elevation: Math.max(-3, Math.min(3, value)),
                        });
                    }}
                  />
                </label>
                {(["interaction", "salience"] as const).map((key) => (
                  <label key={key}>
                    {key === "interaction"
                      ? t("상호작용", "Interaction")
                      : t("현저성", "Salience")}{" "}
                    (0–1)
                    <input
                      aria-label={`${targetLabel(target)} ${key === "interaction" ? t("상호작용", "interaction") : t("현저성", "salience")}`}
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={target[key]}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value))
                          patchTarget(index, {
                            [key]: Math.max(0, Math.min(1, value)),
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="gaze-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={target.visible}
                    onChange={(event) =>
                      patchTarget(index, { visible: event.target.checked })
                    }
                  />
                  {t("{name} 보임", "{name} visible", {
                    name: targetLabel(target),
                  })}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={target.moving}
                    onChange={(event) =>
                      patchTarget(index, { moving: event.target.checked })
                    }
                  />
                  {t("{name} 움직임", "{name} moving", {
                    name: targetLabel(target),
                  })}
                </label>
                {target.kind === "person" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={target.speaking}
                      onChange={(event) =>
                        patchTarget(index, { speaking: event.target.checked })
                      }
                    />
                    {t("사람 발화", "Person speaking")}
                  </label>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      </section>
      <section
        className="gaze-panel gaze-recording"
        aria-labelledby="gaze-record-heading"
      >
        <div className="gaze-section-heading">
          <div>
            <h2 id="gaze-record-heading">
              {t("로컬 기록과 설정", "Local recordings and configuration")}
            </h2>
            <p className="gaze-help">
              {t(
                "기록은 직접 시작할 때만 메모리에 저장됩니다. 최대 1200 프레임, 페이지를 떠나면 사라집니다. 새 기록은 기존 버퍼를 교체합니다.",
                "Recording is stored in memory only when you start it. The limit is 1200 frames; leaving this page clears it. A new recording replaces the existing buffer.",
              )}
            </p>
          </div>
          <strong className={recording ? "gaze-recording-on" : ""}>
            {recording
              ? t("● 기록 중", "● Recording")
              : t("기록 중지", "Not recording")}{" "}
            · {count} / {MAX_RECORDS}
          </strong>
        </div>
        <div className="gaze-actions">
          <button
            type="button"
            className={recording ? "" : "primary"}
            onClick={toggleRecording}
          >
            {recording
              ? t("기록 중지", "Stop recording")
              : t("새 기록 시작", "Start new recording")}
          </button>
          <button type="button" disabled={!count} onClick={exportRecording}>
            {t("기록 JSON 내보내기", "Export recording JSON")}
          </button>
          <button
            type="button"
            onClick={() => downloadJson("gaze-config.json", configRef.current)}
          >
            {t("설정 JSON 내보내기", "Export configuration JSON")}
          </button>
          <label className="gaze-file">
            {t(
              "설정 JSON 가져오기 (최대 64 KiB)",
              "Import configuration JSON (up to 64 KiB)",
            )}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importConfig(event)}
            />
          </label>
        </div>
        <p className="gaze-help">
          {t(
            "기록에는 알고리즘 버전·단위·시드·설정 변경 이력과 모든 프레임의 머리/대상 입력·시선 출력이 포함됩니다. 아바타 저장은 방의 ‘My avatar’에서 적용하세요.",
            "Recordings include the algorithm version, units, seed, configuration history, and head/target inputs and gaze output for every frame. Save avatar settings using “My avatar” in a room.",
          )}
        </p>
        {message && (
          <p className="notice" role="status">
            {t(...message)}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {t(
              "설정을 불러오지 못했습니다.",
              "Could not load the configuration.",
            )}{" "}
            {displayError(t(...error))}
          </p>
        )}
      </section>
    </main>
  );
}
