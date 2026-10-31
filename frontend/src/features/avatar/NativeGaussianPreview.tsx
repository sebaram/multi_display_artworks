import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { loadAFrame } from '../../scene/mountRoom';
import { evaluateFlame, loadFlameModel } from '../../avatar/flame-runtime';
import { gaussianEyePose } from '../../avatar/gaussian-eye-pose';
import type { GazeSnapshot } from '../../avatar/gaze';

const BASE = '/api/v1/dev/gaussian-avatar/';
export type NativeDisplayState = { subject: '306'; sourceRevision: string; pose: 'canonical'; yaw: number; pitch: number; jawDeltaDegrees: number; expression0Delta: number; orbitDegrees: number; zoom: number };

/** Actual private subject-306 geometry, driven by the same recorded lab output. */
export default function NativeGaussianPreview({ gaze, appliedState, summary, targetLabel, targetColor }: {
  gaze: RefObject<GazeSnapshot | null>; appliedState: RefObject<NativeDisplayState | null>;
  summary: GazeSnapshot | null; targetLabel: string; targetColor: string;
}) {
  const eyeId = useId();
  const selected = summary?.scores.find(score => score.id === summary.targetId);
  const yaw = summary?.yaw ?? 0, pitch = summary?.pitch ?? 0;
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('로컬 GaussianAvatars 모델을 불러오는 중…');
  const [error, setError] = useState(''), [jaw, setJaw] = useState(0), [expression, setExpression] = useState(0);
  const [orbit, setOrbit] = useState(0), [zoom, setZoom] = useState(1);
  const controls = useRef({ jaw, expression, orbit, zoom }); controls.current = { jaw, expression, orbit, zoom };
  useEffect(() => {
    const abort = new AbortController();
    let renderer: any, avatar: any, frame = 0;
    const element = host.current!;
    const fail = (reason: unknown) => { if (!abort.signal.aborted) setError((reason as Error).message); };
    void (async () => {
      const ready = await fetch(`${BASE}status`, { signal: abort.signal });
      if (!ready.ok || !(await ready.json()).ready) throw Error('로컬 모델 패키지가 없습니다. FLAME export와 개발 서버의 GAUSSIAN_AVATAR_ROOT 설정을 확인하세요.');
      await loadAFrame();
      if (abort.signal.aborted) return;
      const THREE = (window as any).AFRAME.THREE;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce4e8');
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.domElement.style.cssText = 'width:100%;height:420px;display:block;';
      element.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(38, 1, .005, 20);
      const model = await loadFlameModel(`${BASE}manifest.json`, { signal: abort.signal });
      const moduleUrl = '/vendor/gaussian-avatar-native.js';
      const { createNativeGaussianAvatar } = await import(/* @vite-ignore */ moduleUrl);
      const vertices = evaluateFlame(model, { rotation: [0,0,0], neck: [0,0,0], translation: [0,0,0], eyes: [0,0,0,0,0,0] });
      avatar = await createNativeGaussianAvatar({ scene, renderer, faces: model.faces, vertices,
        plyUrl: new URL(model.manifest.gaussian.file, new URL(`${BASE}manifest.json`, location.href)).href, signal: abort.signal });
      if (abort.signal.aborted) { avatar.dispose(); return; }
      avatar.root.updateMatrixWorld(true);
      const bound = avatar.bounds.clone().applyMatrix4(avatar.root.matrixWorld);
      const center = bound.getCenter(new THREE.Vector3()), size = bound.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.1;
      element.dataset.nativeAvatarState = 'ready'; element.dataset.gaussians = String(avatar.count);
      setStatus(`GaussianAvatars 306 · ${avatar.count.toLocaleString()} Gaussians · FLAME ${model.manifest.vertexCount.toLocaleString()} vertices`);
      let applied = -Infinity, lastKey = '', width = 0;
      const draw = (time: number) => {
        if (abort.signal.aborted) return;
        const c = controls.current;
        if (time - applied >= 50 && document.visibilityState !== 'hidden') {
          const output = gaze.current;
          const yaw = output?.yaw ?? 0, pitch = output?.pitch ?? 0;
          const key = `${yaw.toFixed(4)},${pitch.toFixed(4)},${c.jaw},${c.expression}`;
          if (key !== lastKey) {
            const eyes = gaussianEyePose(yaw, pitch);
            const expr = Array.from(model.defaultParameters.expression); expr[0] += c.expression;
            const jawPose = Array.from(model.defaultParameters.jaw); jawPose[0] += c.jaw * Math.PI / 180;
            const posed = evaluateFlame(model, { expression: expr, jaw: jawPose, eyes,
              rotation: [0,0,0], neck: [0,0,0], translation: [0,0,0] });
            avatar.updateVertices(posed); lastKey = key;
            element.dataset.yaw = String(yaw); element.dataset.pitch = String(pitch);
            element.dataset.poseUpdates = String(Number(element.dataset.poseUpdates ?? 0) + 1);
            appliedState.current = { subject: '306', sourceRevision: model.manifest.sourceRevision, pose: 'canonical', yaw, pitch,
              jawDeltaDegrees: c.jaw, expression0Delta: c.expression, orbitDegrees: c.orbit, zoom: c.zoom };
          }
          applied = time;
        }
        const nextWidth = element.clientWidth || 600;
        if (width !== nextWidth) { width = nextWidth; renderer.setSize(width, 420, false); camera.aspect = width / 420; camera.updateProjectionMatrix(); }
        const angle = c.orbit * Math.PI / 180, radius = distance * c.zoom;
        camera.position.set(center.x + Math.sin(angle) * radius, center.y + size.y * .05, center.z - Math.cos(angle) * radius);
        camera.lookAt(center);
        if (appliedState.current) appliedState.current = { ...appliedState.current, orbitDegrees: c.orbit, zoom: c.zoom };
        renderer.render(scene, camera);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    })().catch(fail);
    return () => {
      abort.abort(); cancelAnimationFrame(frame); avatar?.dispose();
      appliedState.current = null;
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, [gaze, appliedState]);
  return <section className="gaze-panel gaze-scene" aria-label="Native GaussianAvatars preview">
    <h2>네이티브 GaussianAvatars</h2>
    <p className="gaze-help">공식 306 샘플의 학습된 Gaussian을 실제 FLAME 삼각형에 결합해 렌더링합니다. 위 실험과 같은 시선 출력을 눈 관절에 적용합니다. 정렬된 머리 자세를 사용하며 카메라 회전은 시선 계산에 영향을 주지 않습니다.</p>
    <div className="gaze-native-layout">
      <aside className="gaze-native-reference" aria-label="아바타와 함께 보는 시선 도식">
        <h3>눈 회전 도식</h3>
        <svg className="gaze-native-eyes" viewBox="0 0 356 390" role="img" aria-label="Gaussian 아바타와 같은 시선 방향을 보여주는 눈 회전 도식">
          <ellipse cx="178" cy="190" rx="129" ry="156" fill="#e3e9df" />
          {[126, 230].map((x, index) => <g key={x}>
            <defs><clipPath id={`${eyeId}-${index}`}><ellipse cx={x} cy="161" rx="37" ry="24" /></clipPath></defs>
            <ellipse cx={x} cy="161" rx="37" ry="24" fill="white" stroke="#98aaa0" strokeWidth="2" />
            <g clipPath={`url(#${eyeId}-${index})`}>
              <circle cx={x - Math.sin(yaw) * 29} cy={161 - Math.sin(pitch) * 29} r="13" fill="#477274" />
              <circle cx={x - Math.sin(yaw) * 29} cy={161 - Math.sin(pitch) * 29} r="6" fill="#173b3e" />
            </g>
          </g>)}
          <path d="M178 182 l-11 44 h21 M151 266 Q178 276 205 266" fill="none" stroke="#a4b4a6" strokeWidth="3" />
        </svg>
        <div className="gaze-native-target" data-gaze-target={summary?.targetId ?? ''}>
          <span className="gaze-help">현재 타겟</span>
          <strong><span aria-hidden="true" style={{ color: targetColor }}>●</span> {targetLabel}</strong>
          <dl><div><dt>거리</dt><dd>{selected ? `${selected.distance.toFixed(2)} m` : '—'}</dd></div>
            <div><dt>중심 각도</dt><dd>{selected ? `${selected.angleDegrees.toFixed(1)}°` : '—'}</dd></div>
            <div><dt>점수</dt><dd>{selected?.score.toFixed(3) ?? '—'}</dd></div></dl>
        </div>
        <div className="gaze-native-angles"><span>yaw <strong>{(yaw * 180 / Math.PI).toFixed(1)}°</strong></span>
          <span>pitch <strong>{(pitch * 180 / Math.PI).toFixed(1)}°</strong></span></div>
      </aside>
      <div ref={host} className="gaze-native-canvas" data-native-avatar-state="loading" />
    </div>
    <p role="status">{status}</p>{error && <p role="alert">{error}</p>}
    <div className="gaze-fields">
      <label>카메라 회전 · {orbit}°<input aria-label="Native camera orbit" type="range" min="-70" max="70" value={orbit} onChange={e => setOrbit(+e.target.value)} /></label>
      <label>확대 · {zoom.toFixed(1)}<input aria-label="Native camera zoom" type="range" min=".6" max="1.6" step=".1" value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
      <label>턱 회전 추가 · {jaw}°<input aria-label="Native jaw" type="range" min="0" max="20" value={jaw} onChange={e => setJaw(+e.target.value)} /></label>
      <label>표현 계수 0 추가 · {expression.toFixed(1)}<input aria-label="Native expression" type="range" min="-2" max="2" step=".1" value={expression} onChange={e => setExpression(+e.target.value)} /></label>
    </div>
    <p className="gaze-help">로컬 연구용 공식 샘플입니다. 기록에는 적용된 눈·턱·표현 값과 모델 리비전도 포함되며, 화면 영상은 포함하지 않습니다.</p>
  </section>;
}
