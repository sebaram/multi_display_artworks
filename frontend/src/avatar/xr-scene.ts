import { calibrateAvatar } from "./calibration";
import {
  createXRInputState,
  readXRTransform,
  sampleAvatarInput,
  transformXRTarget,
  disposeXRInputState,
  syncXRInputReferenceSpace,
} from "./xr-input";
import { axisAngle, rotate, product, inverse, sub } from "./pose";
import type { Calibration, Transform, Vec3, Quat } from "./types";

/** The pinned renderer's poseTarget is #camera.object3D: its parent is reference→world. */
export function mountAvatarXRInput({
  scene,
  camera,
  ground,
  THREE,
  onReset,
}: {
  scene: any;
  camera: any;
  ground: { height: number } | null;
  THREE: any;
  onReset: () => void;
}) {
  const origin = scene.querySelector("#avatar-xr-origin")?.object3D;
  let session: any,
    endedSession: any,
    initialized = false,
    pendingTeleport = false;
  let calibration: Calibration | undefined,
    state = createXRInputState();
  let lastHead: Transform | null = null;
  let referenceHead: Transform | null = null;
  let pendingRebase:
    | {
        origin: Transform;
        head: Transform | null;
        floor: Vec3;
        relation: Transform | null;
      }
    | undefined;
  let saved:
    | { position: any; quaternion: any; matrixAutoUpdate: boolean }
    | undefined;
  const controls = document.createElement("span");
  controls.hidden = true;
  const posture = document.createElement("select");
  posture.setAttribute("aria-label", "Avatar posture");
  for (const mode of ["standing", "seated"]) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode === "standing" ? "Standing" : "Seated";
    posture.append(option);
  }
  const height = document.createElement("input");
  height.type = "number";
  height.min = ".82";
  height.max = "3.28";
  height.step = ".01";
  height.value = "1.64";
  height.style.width = "5em";
  height.setAttribute("aria-label", "Standing eye height (m)");
  const button = document.createElement("button");
  button.textContent = "Calibrate avatar height";
  controls.append(posture, height, button);
  document.getElementById("room-toolbar")?.append(controls);
  const capturePose = () => {
    if (!saved)
      saved = {
        position: camera.object3D.position.clone(),
        quaternion: camera.object3D.quaternion.clone(),
        matrixAutoUpdate: camera.object3D.matrixAutoUpdate,
      };
  };
  scene.addEventListener("enter-vr", capturePose, true);
  function end() {
    endedSession = session;
    session?.removeEventListener("end", end);
    session = undefined;
    initialized = false;
    disposeXRInputState(state);
    state = createXRInputState();
    lastHead = null;
    referenceHead = null;
    pendingRebase = undefined;
    if (origin) {
      origin.position.set(0, 0, 0);
      origin.quaternion.identity();
      origin.updateMatrixWorld(true);
    }
    if (saved) {
      camera.object3D.position.copy(saved.position);
      camera.object3D.quaternion.copy(saved.quaternion);
      camera.object3D.matrixAutoUpdate = saved.matrixAutoUpdate;
      camera.object3D.updateMatrix();
      saved = undefined;
    }
    controls.hidden = true;
    onReset();
  }
  const exit = () => {
    if (!session) saved = undefined;
  };
  scene.addEventListener("exit-vr", exit);
  const floorMode = (): Calibration["referenceSpace"] =>
    scene.systems?.webxr?.sessionReferenceSpaceType === "local"
      ? "local"
      : "local-floor";
  const viewer = () => {
    const manager = scene.renderer?.xr;
    try {
      return (
        manager?.getFrame?.()?.getViewerPose(manager.getReferenceSpace())
          ?.transform ?? null
      );
    } catch {
      return null;
    }
  };
  function calibrate(manual?: number) {
    if (!session) return;
    calibration = calibrateAvatar({
      viewer: viewer(),
      floorMode: floorMode(),
      posture: posture.value as Calibration["mode"],
      previous: calibration,
      eyeHeight: manual,
    });
    height.value = calibration.eyeHeight.toFixed(2);
    pendingTeleport = true;
    onReset();
  }
  posture.onchange = () => calibrate(calibration?.eyeHeight);
  height.onchange = () => {
    const value = Number(height.value);
    if (Number.isFinite(value) && value >= 0.82 && value <= 3.28)
      calibrate(value);
  };
  button.onclick = () => calibrate();
  function calibrationAction(event: any) {
    if (!session) return;
    const detail = event.detail ?? {};
    if (detail.posture === "standing" || detail.posture === "seated") {
      posture.value = detail.posture;
      calibrate(calibration?.eyeHeight);
    } else if (detail.calibrate === true) calibrate();
    else if (detail.heightDelta === 0.05 || detail.heightDelta === -0.05)
      calibrate((calibration?.eyeHeight ?? 1.64) + detail.heightDelta);
  }
  scene.addEventListener("avatar-calibration", calibrationAction);
  function originTransform(): Transform {
    const parent = camera.object3D.parent;
    parent?.updateWorldMatrix(true, false);
    return parent
      ? {
          position: parent
            .getWorldPosition(new THREE.Vector3())
            .toArray() as Vec3,
          orientation: parent
            .getWorldQuaternion(new THREE.Quaternion())
            .toArray() as Quat,
        }
      : { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
  }
  function placeOrigin(position: any, orientation: any, head: Transform) {
    if (!origin) return;
    const yaw = (q: Quat) => {
      const f = rotate(q, [0, 0, -1]);
      return Math.atan2(-f[0], -f[2]);
    };
    const facing = axisAngle(
      [0, 1, 0],
      yaw(orientation.toArray()) - yaw(head.orientation),
    );
    origin.quaternion.fromArray(facing);
    const local = rotate(facing, head.position);
    origin.position.set(
      position.x - local[0],
      ground
        ? ground.height - calibration!.floorOffset
        : position.y - calibration!.eyeHeight - calibration!.floorOffset,
      position.z - local[2],
    );
    origin.updateMatrixWorld(true);
  }
  function rebaseReference(
    frame: any,
    referenceSpace: any,
    change: ReturnType<typeof syncXRInputReferenceSpace>,
  ) {
    if (change && initialized) {
      let relation = change.transform;
      if (!relation && change.previous && change.previous !== referenceSpace) {
        try {
          relation = readXRTransform(
            frame.getPose(referenceSpace, change.previous),
          );
        } catch {
          /* Unknown mapping: anchor the next valid viewer pose. */
        }
      }
      const before = originTransform();
      pendingRebase = {
        origin: before,
        head: referenceHead,
        floor: transformXRTarget(
          {
            position: [0, calibration!.floorOffset, 0],
            orientation: [0, 0, 0, 1],
          },
          before,
        ).position,
        relation,
      };
      pendingTeleport = true;
    }
    if (!pendingRebase || !origin) return;
    const anchor = pendingRebase,
      head = readXRTransform({ transform: viewer() });
    let next: Transform;
    if (anchor.relation)
      next = transformXRTarget(anchor.relation, anchor.origin);
    else if (anchor.head && head) {
      const orientation = product(
        anchor.head.orientation,
        inverse(head.orientation),
      );
      next = {
        orientation,
        position: sub(anchor.head.position, rotate(orientation, head.position)),
      };
    } else return;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(next.position),
      new THREE.Quaternion().fromArray(next.orientation),
      new THREE.Vector3(1, 1, 1),
    );
    if (origin.parent) {
      origin.parent.updateWorldMatrix(true, false);
      matrix.premultiply(origin.parent.matrixWorld.clone().invert());
    }
    matrix.decompose(origin.position, origin.quaternion, origin.scale);
    origin.updateMatrixWorld(true);
    calibration = {
      ...calibration!,
      referenceSpace: floorMode(),
      floorOffset: rotate(
        inverse(next.orientation),
        sub(anchor.floor, next.position),
      )[1],
    };
    pendingRebase = undefined;
    pendingTeleport = true;
  }
  function teleport() {
    if (!session || !initialized) return;
    const head = readXRTransform({ transform: viewer() });
    if (!head) return;
    // Existing teleport presets address scene-local eye XZ/yaw, even while the entity is tracked.
    placeOrigin(camera.object3D.position, camera.object3D.quaternion, head);
    pendingTeleport = true;
    onReset();
  }
  camera?.addEventListener("avatar-teleport", teleport);
  const originClamped = () => {
    pendingTeleport = true;
  };
  camera?.addEventListener("avatar-xr-origin-clamped", originClamped);
  return {
    get active() {
      return !!session;
    },
    sample(sampleTime: number, teleportRequested = false) {
      const manager = scene.renderer?.xr,
        current = manager?.getSession?.();
      if (current !== session && current !== endedSession) {
        if (session) end();
        if (current) {
          capturePose();
          session = current;
          session.addEventListener("end", end);
          pendingTeleport = true;
        }
      }
      if (!current && session) end();
      if (!session) return null;
      const frame = manager.getFrame?.(),
        referenceSpace = manager.getReferenceSpace?.();
      const referenceChange = syncXRInputReferenceSpace(
        state,
        frame ? referenceSpace : undefined,
        frame?.session,
      );
      rebaseReference(frame, referenceSpace, referenceChange);
      if (!initialized) {
        const head = readXRTransform({ transform: viewer() });
        if (!head) return null;
        // Entry may already be seated. Stature changes only through explicit calibration/manual size.
        calibration = calibrateAvatar({
          viewer: viewer(),
          floorMode: floorMode(),
          posture: posture.value as Calibration["mode"],
          previous: calibration,
          eyeHeight: calibration?.eyeHeight ?? 1.64,
        });
        height.value = calibration.eyeHeight.toFixed(2);
        placeOrigin(saved!.position, saved!.quaternion, head);
        initialized = true;
        controls.hidden = false;
      }
      camera.components?.["boundary-clamp"]?.clampXRBoundary?.();
      const input = sampleAvatarInput({
        frame,
        referenceSpace,
        xrOrigin: originTransform(),
        calibration: calibration!,
        sampleTime,
        state,
        floorHeight: ground?.height,
        teleport: pendingTeleport || teleportRequested,
      });
      if ((pendingTeleport || teleportRequested) && input.head)
        scene.emit("avatar-xr-origin-changed", { head: input.head }, false);
      pendingTeleport = false;
      lastHead = input.head;
      if (input.head) referenceHead = input.head;
      return input;
    },
    transformHand(hand: any) {
      const mapped: any = {};
      for (const [name, joint] of Object.entries(hand) as [string, any][]) {
        mapped[name] =
          joint?.position && joint?.rotation
            ? (() => {
                const t = transformXRTarget(
                  { position: joint.position, orientation: joint.rotation },
                  originTransform(),
                );
                return { position: t.position, rotation: t.orientation };
              })()
            : null;
      }
      return mapped;
    },
    legacyPose() {
      if (!lastHead) return null;
      const p = lastHead.position,
        r = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().fromArray(lastHead.orientation),
          "YXZ",
        ),
        deg = 180 / Math.PI;
      return {
        position: { x: p[0], y: p[1], z: p[2] },
        rotation: { x: r.x * deg, y: r.y * deg, z: r.z * deg },
      };
    },
    dispose() {
      session?.removeEventListener("end", end);
      if (session) end();
      scene.removeEventListener("enter-vr", capturePose, true);
      scene.removeEventListener("exit-vr", exit);
      scene.removeEventListener("avatar-calibration", calibrationAction);
      camera?.removeEventListener("avatar-teleport", teleport);
      camera?.removeEventListener("avatar-xr-origin-clamped", originClamped);
      disposeXRInputState(state);
      controls.remove();
    },
  };
}
