import { useEffect, useRef, useState, lazy, Suspense, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createGazeController, DEFAULT_GAZE_CONFIG, GAZE_ALGORITHM_VERSION, normalizeGazeConfig,
  type GazeConfig, type GazeController, type GazeFrame, type GazeSnapshot, type GazeTarget,
} from '../../avatar/gaze';
import { GazeControls } from './GazeControls';
import './gaze-lab.css';
import type { NativeDisplayState } from './NativeGaussianPreview';
const NativeGaussianPreview = lazy(() => import('./NativeGaussianPreview'));

const MAX_RECORDS = 1200;
const MAX_CONFIG_BYTES = 64 * 1024;
const DEG = Math.PI / 180;
type LabTarget = {
  id: string; label: string; kind: GazeTarget['kind']; color: string;
  angle: number; distance: number; elevation: number; visible: boolean;
  speaking: boolean; moving: boolean; interaction: number; salience: number;
};
type Scene = { headYaw: number; targets: LabTarget[] };
type RecordedSample = { frame: GazeFrame; gaze: GazeSnapshot; configIndex: number; nativeDisplay: NativeDisplayState | null };
type Recording = {
  samples: RecordedSample[]; configChanges: Array<{ time: number; config: GazeConfig }>;
  lastConfig: GazeConfig | null; active: boolean; startedAt: string | null;
};
const INITIAL_SCENE: Scene = { headYaw: 0, targets: [
  { id: 'person', label: '사람', kind: 'person', color: '#a34a3c', angle: -18, distance: 5, elevation: 0, visible: true, speaking: false, moving: false, interaction: 0, salience: 0.4 },
  { id: 'artwork', label: '작품', kind: 'artwork', color: '#296b8a', angle: 22, distance: 6, elevation: 0.5, visible: true, speaking: false, moving: false, interaction: 0, salience: 0.7 },
  { id: 'marker', label: '마커', kind: 'marker', color: '#8a6a20', angle: 8, distance: 7, elevation: -0.4, visible: true, speaking: false, moving: true, interaction: 0, salience: 0.5 },
] };

function makeFrame(scene: Scene, time: number, reset: boolean): GazeFrame {
  const halfYaw = scene.headYaw * DEG / 2;
  return {
    time, reset, head: { position: [0, 1.6, 0], orientation: [0, -Math.sin(halfYaw), 0, Math.cos(halfYaw)] },
    targets: scene.targets.map(target => {
      const angle = (target.angle + (target.moving ? Math.sin(time / 1800) * 35 : 0)) * DEG;
      return {
        id: target.id, kind: target.kind,
        position: [Math.sin(angle) * target.distance, 1.6 + target.elevation, -Math.cos(angle) * target.distance],
        visible: target.visible, speaking: target.speaking ? 1 : 0,
        interaction: target.interaction, motion: target.moving ? 1 : 0, salience: target.salience,
      };
    }),
  };
}

function drawDiagram(canvas: HTMLCanvasElement, scene: Scene, config: GazeConfig, frame: GazeFrame, gaze: GazeSnapshot) {
  const narrow = canvas.clientWidth < 520;
  const logicalWidth = narrow ? 620 : 1000, logicalHeight = narrow ? 1100 : 560;
  if (canvas.width !== logicalWidth || canvas.height !== logicalHeight) { canvas.width = logicalWidth; canvas.height = logicalHeight; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width, height = canvas.height, cx = 310, cy = 306;
  const extent = Math.max(8, config.maxDistance, ...scene.targets.map(target => target.distance));
  const scale = 230 / extent, radius = config.maxDistance * scale;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f5f7f3'; ctx.fillRect(0, 0, width, height);
  ctx.font = `${narrow ? 19 : 15}px "Segoe UI", sans-serif`; ctx.fillStyle = '#566964';
  ctx.fillText('위에서 본 장면 · Y 위 / −Z 정면', 24, 32);
  ctx.strokeStyle = '#e1e8e0'; ctx.lineWidth = 1;
  for (let ring = 1; ring <= 3; ring++) {
    ctx.beginPath(); ctx.arc(cx, cy, 230 * ring / 3, 0, Math.PI * 2); ctx.stroke();
  }
  const yaw = scene.headYaw * DEG;
  const start = yaw - Math.PI / 2 - config.coneDegrees * DEG / 2;
  const end = yaw - Math.PI / 2 + config.coneDegrees * DEG / 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, start, end); ctx.closePath();
  ctx.fillStyle = '#2a797c17'; ctx.fill(); ctx.strokeStyle = '#87b2aa'; ctx.stroke();
  ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(yaw) * radius, cy - Math.cos(yaw) * radius); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#657771'; ctx.font = `${narrow ? 18 : 12}px "Segoe UI", sans-serif`;
  ctx.fillText(`${config.maxDistance} m · 전체 ${config.coneDegrees}°`, 24, 536);
  frame.targets.forEach((target, index) => {
    const model = scene.targets[index], x = cx + target.position[0] * scale, y = cy + target.position[2] * scale;
    ctx.globalAlpha = target.visible ? 1 : 0.35;
    if (gaze.targetId === target.id) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.strokeStyle = model.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = model.color; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${narrow ? 19 : 14}px "Segoe UI", sans-serif`; ctx.fillText(`${model.label}${target.speaking ? ' · 발화' : ''}${target.visible ? '' : ' · 숨김'}`, x + 13, y - 11);
    ctx.globalAlpha = 1;
  });
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(yaw);
  ctx.fillStyle = '#dae2d7'; ctx.strokeStyle = '#3d6058'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 23, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -25); ctx.lineTo(0, -35); ctx.lineTo(5, -25); ctx.stroke();
  ctx.strokeStyle = '#185b60'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.lineTo(Math.sin(gaze.yaw) * 55, -Math.cos(gaze.yaw) * 55); ctx.stroke(); ctx.restore();

  ctx.save();
  if (narrow) ctx.translate(-500, 540);
  ctx.fillStyle = '#fff'; ctx.fillRect(624, 20, 356, 520);
  ctx.fillStyle = '#405a53'; ctx.font = `${narrow ? 19 : 15}px "Segoe UI", sans-serif`; ctx.fillText('눈 회전 도식 · 정면에서 보기', 644, 54);
  ctx.fillStyle = '#e3e9df'; ctx.beginPath(); ctx.ellipse(802, 240, 129, 156, 0, 0, Math.PI * 2); ctx.fill();
  for (const x of [750, 854]) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#98aaa0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, 211, 37, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // In a front view, the head's local +X appears on the viewer's left.
    const dx = -Math.sin(gaze.yaw) * 29, dy = -Math.sin(gaze.pitch) * 29;
    ctx.fillStyle = '#477274'; ctx.beginPath(); ctx.arc(x + dx, 211 + dy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#173b3e'; ctx.beginPath(); ctx.arc(x + dx, 211 + dy, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#a4b4a6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(802, 232); ctx.lineTo(791, 276); ctx.lineTo(812, 276); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(775, 316); ctx.quadraticCurveTo(802, 326, 829, 316); ctx.stroke();
  ctx.font = `${narrow ? 19 : 14}px "Segoe UI", sans-serif`; ctx.fillStyle = '#405a53';
  ctx.fillText(`yaw ${(gaze.yaw / DEG).toFixed(1)}° · pitch ${(gaze.pitch / DEG).toFixed(1)}°`, 659, 435);
  ctx.fillStyle = '#6a7a72'; ctx.font = `${narrow ? 18 : 13}px "Segoe UI", sans-serif`;
  ctx.fillText('양쪽 눈에 동일한 방향을 적용', 659, 465);
  ctx.fillText('GaussianAvatars 모델 렌더가 아닙니다', 659, 490);
  ctx.restore();
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function GazeLab({ native = false }: { native?: boolean }) {
  const [config, setConfig] = useState(() => normalizeGazeConfig(DEFAULT_GAZE_CONFIG));
  const [scene, setScene] = useState<Scene>(INITIAL_SCENE);
  const [summary, setSummary] = useState<GazeSnapshot | null>(null);
  const [recording, setRecording] = useState(false), [count, setCount] = useState(0);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const nativeGaze = useRef<GazeSnapshot | null>(null);
  const nativeDisplay = useRef<NativeDisplayState | null>(null);
  const [showNative, setShowNative] = useState(native);
  const controller = useRef<GazeController | null>(null);
  if (!controller.current) controller.current = createGazeController(config);
  const configRef = useRef(config), sceneRef = useRef(scene), origin = useRef(0), needsReset = useRef(true);
  const recordingRef = useRef<Recording>({ samples: [], configChanges: [], lastConfig: null, active: false, startedAt: null });

  useEffect(() => {
    let raf = 0, lastSummary = -Infinity;
    origin.current = performance.now();
    const animate = (now: number) => {
      const frame = makeFrame(sceneRef.current, Math.max(0, now - origin.current), needsReset.current);
      needsReset.current = false;
      const gaze = controller.current!.step(frame);
      nativeGaze.current = gaze;
      if (canvas.current) drawDiagram(canvas.current, sceneRef.current, configRef.current, frame, gaze);
      const log = recordingRef.current;
      if (log.active) {
        if (log.lastConfig !== configRef.current) {
          log.configChanges.push({ time: frame.time, config: configRef.current });
          log.lastConfig = configRef.current;
        }
        log.samples.push({ frame, gaze, configIndex: log.configChanges.length - 1, nativeDisplay: nativeDisplay.current ? { ...nativeDisplay.current } : null });
        if (log.samples.length >= MAX_RECORDS) {
          log.active = false; setRecording(false);
          setMessage('1200 프레임에 도달해 기록을 중지했습니다. JSON으로 내보낼 수 있습니다.');
        }
      }
      if (now - lastSummary >= 100) {
        setSummary(gaze); setCount(log.samples.length); lastSummary = now;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const changeConfig = (value: GazeConfig) => {
    const next = normalizeGazeConfig(value, true);
    configRef.current = next; controller.current!.configure(next); needsReset.current = true; setConfig(next);
  };
  const changeScene = (next: Scene) => { sceneRef.current = next; setScene(next); };
  const patchTarget = (index: number, patch: Partial<LabTarget>) => changeScene({ ...scene, targets: scene.targets.map((target, i) => i === index ? { ...target, ...patch } : target) });
  const reset = () => {
    recordingRef.current.active = false; setRecording(false);
    controller.current!.reset(); origin.current = performance.now(); needsReset.current = true;
    setMessage('시간과 시선 상태를 초기화했습니다. 기존 기록은 내보내기 전까지 유지됩니다.');
  };
  const toggleRecording = () => {
    const log = recordingRef.current;
    if (log.active) {
      log.active = false; setRecording(false); setCount(log.samples.length); setMessage('로컬 기록을 중지했습니다.');
    } else {
      recordingRef.current = { samples: [], configChanges: [], lastConfig: null, active: true, startedAt: new Date().toISOString() };
      controller.current!.reset(); origin.current = performance.now(); needsReset.current = true;
      setCount(0); setRecording(true); setMessage('새 기록을 시작했습니다. 이전 로컬 버퍼를 교체하고 시간·시선 상태를 초기화했습니다.');
    }
  };
  async function importConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setError('');
    try {
      if (file.size > MAX_CONFIG_BYTES) throw new Error('설정 파일은 64 KiB 이하여야 합니다.');
      changeConfig(normalizeGazeConfig(JSON.parse(await file.text()), true));
      setMessage('설정을 불러오고 시선 상태를 초기화했습니다.');
    } catch (reason) {
      setError(`설정을 불러오지 못했습니다. ${reason instanceof Error ? reason.message : '올바른 JSON 설정인지 확인하세요.'}`);
    }
  }
  const exportRecording = () => {
    const log = recordingRef.current;
    if (!log.samples.length) return;
    downloadJson('gaze-recording.json', {
      format: 'procedural-gaze-lab', version: 1, algorithmVersion: GAZE_ALGORITHM_VERSION,
      timeUnit: 'milliseconds', angleUnit: 'radians', distanceUnit: 'meters',
      coordinates: { up: '+Y', forward: '-Z', quaternion: 'XYZW', positiveYaw: 'head-local +X', positivePitch: 'head-local +Y' },
      startedAt: log.startedAt, exportedAt: new Date().toISOString(), maxRecords: MAX_RECORDS,
      config: log.configChanges[0].config, seed: log.configChanges[0].config.seed,
      configChanges: log.configChanges, samples: log.samples,
      note: 'Local procedural diagram. Each frame contains engine inputs and solved output. Configure resets the controller; frame.reset records explicit resets.',
    });
    setMessage(`${log.samples.length} 프레임의 로컬 기록을 내보냈습니다.`);
  };
  const selectedTarget = scene.targets.find(target => target.id === summary?.targetId);

  return <main className="page gaze-lab">
    <Link to="/tools" className="gaze-back">← 도구</Link>
    <header className="gaze-heading">
      <div><div className="eyebrow">PROCEDURAL GAZE / LOCAL EXPERIMENT</div><h1>시선 실험실</h1>
        <p>대상 선택과 눈 회전의 규칙을 조정하고 같은 입력으로 실험을 재현합니다.</p></div>
      <span className="gaze-version">{GAZE_ALGORITHM_VERSION}</span>
    </header>
    <div className="gaze-disclosure"><strong>절차적 시선 도식</strong> · GaussianAvatars 샘플이나 눈 추적 데이터가 아닙니다.
      아래에서 로컬 네이티브 GaussianAvatars도 같은 시선으로 확인할 수 있습니다. 자연스러움과 관찰자의 인지 여부는 검증 전 가설입니다.</div>
    <div className="gaze-workspace">
      <section className="gaze-preview" aria-labelledby="gaze-diagram-heading">
        <div className="gaze-section-heading"><h2 id="gaze-diagram-heading">실시간 도식</h2><button type="button" onClick={reset}>시간·시선 초기화</button></div>
        <canvas ref={canvas} width="1000" height="560" aria-label="머리와 눈, 시야각 원뿔, 사람·작품·마커를 표시한 절차적 시선 도식" role="img" />
        <div className="gaze-readout" aria-label="현재 시선 상태">
          <span>대상 <strong>{summary?.targetId ?? '정면'}</strong></span>
          <span>yaw <strong>{((summary?.yaw ?? 0) / DEG).toFixed(1)}°</strong></span>
          <span>pitch <strong>{((summary?.pitch ?? 0) / DEG).toFixed(1)}°</strong></span>
          <span>시간 <strong>{((summary?.time ?? 0) / 1000).toFixed(1)} s</strong></span>
        </div>
        <p className="gaze-help">선택은 10 Hz, 평활화와 도식은 렌더 프레임마다 계산합니다. 수치·표는 최대 10 Hz로 갱신됩니다. 눈 회전은 head-local 각도입니다.</p>
        <div className="gaze-table-wrap"><table className="gaze-score-table"><caption>시야각·거리·가시성 검사를 통과한 대상</caption>
          <colgroup><col style={{ width: '34%' }} /><col style={{ width: '18%' }} /><col style={{ width: '28%' }} /><col style={{ width: '20%' }} /></colgroup>
          <thead><tr><th scope="col">대상</th><th scope="col">점수</th><th scope="col">시야 중심 각도</th><th scope="col">거리</th></tr></thead>
          <tbody>{summary?.scores.length ? summary.scores.map(score => <tr key={score.id} className={summary.targetId === score.id ? 'is-selected' : ''}>
            <th scope="row">{score.id}{summary.targetId === score.id ? ' · 선택' : ''}</th><td>{score.score.toFixed(3)}</td><td>{score.angleDegrees.toFixed(1)}°</td><td>{score.distance.toFixed(2)} m</td>
          </tr>) : <tr><td colSpan={4}>조건을 통과한 대상이 없습니다.</td></tr>}</tbody>
        </table></div>
      </section>
      <aside className="gaze-panel" aria-labelledby="gaze-config-heading"><h2 id="gaze-config-heading">시선 설정</h2><GazeControls config={config} onChange={changeConfig} /></aside>
    </div>
    <div className="gaze-actions gaze-scene"><button type="button" onClick={() => setShowNative(!showNative)}>{showNative ? 'GaussianAvatars 닫기' : '로컬 GaussianAvatars 열기'}</button></div>
    {showNative && <Suspense fallback={<p role="status">네이티브 렌더러 로딩 중…</p>}><NativeGaussianPreview gaze={nativeGaze} appliedState={nativeDisplay}
      summary={summary} targetLabel={selectedTarget?.label ?? '정면'} targetColor={selectedTarget?.color ?? '#185b60'} /></Suspense>}
    <section className="gaze-panel gaze-scene" aria-labelledby="gaze-scene-heading">
      <div className="gaze-section-heading"><div><h2 id="gaze-scene-heading">장면 입력</h2><p className="gaze-help">마이크·카메라 입력 없이 수동 신호를 사용합니다. 움직임은 기준 각도 ±35°의 결정적 진동입니다.</p></div>
        <label>머리 yaw · {scene.headYaw}°<input aria-label="머리 yaw" type="range" min="-180" max="180" step="1" value={scene.headYaw} onChange={event => changeScene({ ...scene, headYaw: event.target.valueAsNumber })} /></label>
      </div>
      <div className="gaze-target-grid">{scene.targets.map((target, index) => <fieldset key={target.id} className="gaze-target">
        <legend><span style={{ color: target.color }}>●</span> {target.label} · {target.kind}</legend>
        <label>기준 방향 · {target.angle}°<input aria-label={`${target.label} 방향`} type="range" min="-180" max="180" step="1" value={target.angle} onChange={event => patchTarget(index, { angle: event.target.valueAsNumber })} /></label>
        <div className="gaze-fields">
          <label>거리 (m)<input aria-label={`${target.label} 거리`} type="number" min="0.5" max="20" step="0.5" value={target.distance} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchTarget(index, { distance: Math.max(0.5, Math.min(20, value)) }); }} /></label>
          <label>눈높이 차 (m)<input aria-label={`${target.label} 높이`} type="number" min="-3" max="3" step="0.1" value={target.elevation} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchTarget(index, { elevation: Math.max(-3, Math.min(3, value)) }); }} /></label>
          {(['interaction', 'salience'] as const).map(key => <label key={key}>{key === 'interaction' ? '상호작용' : '현저성'} (0–1)<input aria-label={`${target.label} ${key}`} type="number" min="0" max="1" step="0.1" value={target[key]} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchTarget(index, { [key]: Math.max(0, Math.min(1, value)) }); }} /></label>)}
        </div>
        <div className="gaze-toggles">
          <label><input type="checkbox" checked={target.visible} onChange={event => patchTarget(index, { visible: event.target.checked })} />{target.label} 보임</label>
          <label><input type="checkbox" checked={target.moving} onChange={event => patchTarget(index, { moving: event.target.checked })} />{target.label} 움직임</label>
          {target.kind === 'person' && <label><input type="checkbox" checked={target.speaking} onChange={event => patchTarget(index, { speaking: event.target.checked })} />사람 발화</label>}
        </div>
      </fieldset>)}</div>
    </section>
    <section className="gaze-panel gaze-recording" aria-labelledby="gaze-record-heading">
      <div className="gaze-section-heading"><div><h2 id="gaze-record-heading">로컬 기록과 설정</h2><p className="gaze-help">기록은 직접 시작할 때만 메모리에 저장됩니다. 최대 1200 프레임, 페이지를 떠나면 사라집니다. 새 기록은 기존 버퍼를 교체합니다.</p></div><strong className={recording ? 'gaze-recording-on' : ''}>{recording ? '● 기록 중' : '기록 중지'} · {count} / {MAX_RECORDS}</strong></div>
      <div className="gaze-actions"><button type="button" className={recording ? '' : 'primary'} onClick={toggleRecording}>{recording ? '기록 중지' : '새 기록 시작'}</button>
        <button type="button" disabled={!count} onClick={exportRecording}>기록 JSON 내보내기</button>
        <button type="button" onClick={() => downloadJson('gaze-config.json', configRef.current)}>설정 JSON 내보내기</button>
        <label className="gaze-file">설정 JSON 가져오기 (최대 64 KiB)<input type="file" accept="application/json,.json" onChange={event => void importConfig(event)} /></label>
      </div>
      <p className="gaze-help">기록에는 알고리즘 버전·단위·시드·설정 변경 이력과 모든 프레임의 머리/대상 입력·시선 출력이 포함됩니다. 아바타 저장은 방의 ‘My avatar’에서 적용하세요.</p>
      {message && <p className="notice" role="status">{message}</p>}{error && <p className="notice error" role="alert">{error}</p>}
    </section>
  </main>;
}
