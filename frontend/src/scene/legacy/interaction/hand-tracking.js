import { MIN_SEND_INTERVAL_MS } from "../core/sync-constants.js";

function jointPose(frame, referenceSpace, hand, name) {
  const jointSpace = hand.get(name);
  if (
    !jointSpace ||
    typeof frame?.getJointPose !== "function" ||
    !referenceSpace
  )
    return null;
  const pose = frame.getJointPose(jointSpace, referenceSpace);
  const position = pose?.transform?.position;
  if (!position) return null;
  const orientation = pose.transform.orientation;
  return {
    position: [position.x, position.y, position.z],
    rotation: orientation
      ? [orientation.x, orientation.y, orientation.z, orientation.w]
      : null,
  };
}

export function collectHandPoses(frame, referenceSpace, sources) {
  let leftHand = null;
  let rightHand = null;

  for (const source of sources) {
    if (!source.hand || source.handedness === "none") continue;
    const data = {
      wrist: jointPose(frame, referenceSpace, source.hand, "wrist"),
      thumbTip: jointPose(frame, referenceSpace, source.hand, "thumb-tip"),
      indexTip: jointPose(frame, referenceSpace, source.hand, "index-tip"),
      middleTip: jointPose(frame, referenceSpace, source.hand, "middle-tip"),
    };
    if (!Object.values(data).some(Boolean)) continue;
    if (source.handedness === "left") leftHand = data;
    if (source.handedness === "right") rightHand = data;
  }
  return { leftHand, rightHand };
}

/** A-Frame owns the session and animation loop. This consumer only samples its active frame. */
export function mountHandTracking({
  document,
  scene,
  navigator,
  socketClient,
  roomId,
  setInterval,
  clearInterval,
  console,
  onHandRaiseDetected,
  posePublisher,
  now,
  shouldPublish = () => true,
  transformHand = (hand) => hand,
  cameraPose,
}) {
  let destroyed = false,
    session = null,
    referenceSpace = null,
    button = null;
  let lastHandSend = -Infinity,
    handsPresent = false;
  const raised = { left: false, right: false };
  function publish(leftHand = null, rightHand = null, handTracking = false) {
    if (!shouldPublish()) return;
    const camera = document.getElementById("camera");
    if (!camera) return;
    const worldPose = cameraPose?.();
    const position = worldPose?.position ?? camera.getAttribute("position"),
      rotation = worldPose?.rotation ?? camera.getAttribute("rotation");
    const hasHands = leftHand !== null || rightHand !== null;
    const changed = hasHands !== handsPresent;
    handsPresent = hasHands;
    if (
      !hasHands &&
      !changed &&
      !posePublisher.shouldSend({ position, rotation }, now())
    )
      return;
    if (
      socketClient.emit("position_update", {
        room_id: roomId,
        position,
        rotation,
        leftHand,
        rightHand,
        handTracking,
      }) === false
    )
      posePublisher.reset();
  }
  function ended() {
    session?.removeEventListener?.("end", ended);
    session = null;
    referenceSpace = null;
    raised.left = false;
    raised.right = false;
    publish();
    if (button) button.style.background = "#666";
  }
  function tick(time) {
    if (destroyed) return;
    const manager = scene?.renderer?.xr,
      current = manager?.getSession?.();
    if (current !== session) {
      if (session) ended();
      session = current;
      session?.addEventListener?.("end", ended);
      lastHandSend = -Infinity;
    }
    if (!session || time - lastHandSend < MIN_SEND_INTERVAL_MS) return;
    lastHandSend = time;
    const frame = manager.getFrame?.();
    referenceSpace = manager.getReferenceSpace?.();
    if (!frame || !referenceSpace) return;
    try {
      const raw = collectHandPoses(
        frame,
        referenceSpace,
        session.inputSources ?? [],
      );
      const viewerY =
        frame.getViewerPose?.(referenceSpace)?.transform?.position?.y;
      for (const side of ["left", "right"]) {
        const wristY = raw[`${side}Hand`]?.wrist?.position?.[1];
        const up =
          Number.isFinite(viewerY) &&
          Number.isFinite(wristY) &&
          wristY > viewerY + 0.15;
        if (up && !raised[side]) onHandRaiseDetected?.(side);
        raised[side] = up;
      }
      const left = raw.leftHand && transformHand(raw.leftHand),
        right = raw.rightHand && transformHand(raw.rightHand);
      publish(left, right, !!(left || right));
    } catch (error) {
      console.error("Hand tracking frame unavailable:", error);
      publish();
    }
  }
  async function addButton() {
    if (!navigator.xr) return;
    try {
      if (!(await navigator.xr.isSessionSupported("immersive-vr")) || destroyed)
        return;
    } catch {
      return;
    }
    button = document.createElement("button");
    button.id = "hand-tracking-btn";
    button.textContent = "🤚 Enter VR / Hands";
    button.style.cssText =
      "position:fixed;bottom:20px;right:20px;padding:10px 20px;background:#666;color:white;border:none;border-radius:8px;z-index:9999;";
    button.addEventListener("click", () => {
      if (!session)
        Promise.resolve(scene?.enterVR?.()).catch((error) =>
          console.error("VR entry failed:", error),
        );
    });
    document.body.appendChild(button);
  }
  const timer = setInterval(() => {
    if (!scene?.renderer?.xr?.getSession?.()) publish();
  }, MIN_SEND_INTERVAL_MS);
  void addButton();
  return {
    tick,
    destroy() {
      destroyed = true;
      session?.removeEventListener?.("end", ended);
      session = null;
      clearInterval(timer);
      button?.remove();
    },
  };
}
