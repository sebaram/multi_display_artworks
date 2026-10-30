import { loadFlameModel, evaluateFlame, type FlameModel } from './flame-runtime';
import { gaussianEyePose } from './gaussian-eye-pose';
import type { GazePose } from './types';

const BASE = '/api/v1/dev/gaussian-avatar/';
const ZERO = [0, 0, 0];
let sharedModel: Promise<FlameModel> | undefined;

function model(): Promise<FlameModel> {
  // One consumer leaving must not abort another avatar's shared immutable rig.
  return sharedModel ??= loadFlameModel(`${BASE}manifest.json`).catch(error => {
    sharedModel = undefined;
    throw error;
  });
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Native avatar disposed', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

type Detail = 'full' | 'low' | 'hidden';
type NativeHead = {
  applyGaze(gaze?: GazePose): void;
  setDetail(detail: Detail): void;
  dispose(): void;
};

/** Attach the local research subject to the existing head bone/anchor. */
export async function attachNativeGaussianHead({ scene, renderer, aframeScene, anchor, signal }: {
  scene: any; renderer: any; aframeScene?: any; anchor: any; signal?: AbortSignal;
}): Promise<NativeHead> {
  const controller = new AbortController();
  let native: any, timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, detail: Detail = 'full';
  let yaw = 0, pitch = 0, appliedYaw = 0, appliedPitch = 0;
  let hasApplied = false, lastUpdate = -Infinity;
  function cancelTimer() {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    cancelTimer();
    controller.abort();
    native?.dispose();
  }
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) { dispose(); throw new DOMException('Native avatar disposed', 'AbortError'); }
  try {
    const moduleUrl = '/vendor/gaussian-avatar-native.js';
    const [rig, { createNativeGaussianAvatar }] = await untilAborted(Promise.all([
      model(), import(/* @vite-ignore */ moduleUrl),
    ]), controller.signal);
    const canonical = { rotation: ZERO, neck: ZERO, translation: ZERO, eyes: gaussianEyePose(0, 0) };
    const vertices = evaluateFlame(rig, canonical);
    native = await createNativeGaussianAvatar({ scene: aframeScene ?? scene, renderer,
      plyUrl: `${BASE}${rig.manifest.gaussian.file}`, faces: rig.faces, vertices, signal: controller.signal });
    if (disposed || controller.signal.aborted) throw new DOMException('Native avatar disposed', 'AbortError');
    native.root.position.set(0, .007, -.11);
    anchor.add(native.root);

    function flush(force = false) {
      if (disposed || detail !== 'full') return;
      if (!force && Math.abs(yaw - appliedYaw) < .001 && Math.abs(pitch - appliedPitch) < .001) return;
      const now = performance.now(), delay = 50 - (now - lastUpdate);
      if (!force && delay > 0) {
        if (timer === undefined) timer = setTimeout(() => { timer = undefined; flush(); }, Math.ceil(delay));
        return;
      }
      cancelTimer();
      evaluateFlame(rig, { ...canonical, eyes: gaussianEyePose(yaw, pitch) }, vertices);
      native.updateVertices(vertices);
      appliedYaw = yaw; appliedPitch = pitch; hasApplied = true; lastUpdate = now;
    }
    return {
      applyGaze(gaze) {
        if (disposed) return;
        const nextYaw = gaze?.yaw ?? 0, nextPitch = gaze?.pitch ?? 0;
        if (!Number.isFinite(nextYaw) || !Number.isFinite(nextPitch)) return;
        yaw = nextYaw; pitch = nextPitch;
        flush(!hasApplied);
      },
      setDetail(next) {
        if (disposed || detail === next) return;
        detail = next;
        native.setVisible(next === 'full');
        if (next === 'full') flush(true); else cancelTimer();
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
