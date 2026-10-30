import type { AvatarAppearanceV2, AvatarCatalog } from "../../avatar/types";

/** A-Frame controller rays and a gaze cursor keep this panel usable without a DOM overlay. */
export function mountAvatarXRPanel({
  scene,
  catalog,
  current,
  apply,
}: {
  scene: any;
  catalog: AvatarCatalog;
  current(): AvatarAppearanceV2;
  apply(appearance: AvatarAppearanceV2): Promise<void>;
}) {
  const panel: any = document.createElement("a-entity");
  panel.id = "avatar-xr-panel";
  panel.setAttribute("visible", "false");
  const background = document.createElement("a-plane");
  background.setAttribute("width", "1.35");
  background.setAttribute("height", "1.85");
  background.setAttribute("position", "0 -.3 0");
  background.setAttribute("color", "#17232f");
  panel.append(background);
  let draft = current(),
    busy = false,
    active = false,
    generation = 0;
  const title = document.createElement("a-text");
  title.setAttribute("position", "-.6 .42 .01");
  title.setAttribute("width", "1.4");
  panel.append(title);
  const status = (text: string) => title.setAttribute("value", text);
  status("My avatar - select, Apply or Revert");
  function button(label: string, x: number, y: number, action: () => void) {
    const target = document.createElement("a-plane");
    target.classList.add("avatar-xr-action");
    target.setAttribute("width", ".58");
    target.setAttribute("height", ".16");
    target.setAttribute("position", `${x} ${y} .02`);
    target.setAttribute("color", "#36556b");
    const text = document.createElement("a-text");
    text.setAttribute("value", label);
    text.setAttribute("align", "center");
    text.setAttribute("width", "1.4");
    text.setAttribute("position", "0 0 .01");
    target.append(text);
    target.addEventListener("click", () => {
      if (active && !busy) action();
    });
    panel.append(target);
  }
  catalog.presets
    .filter((p) => p.kind === "humanoid")
    .forEach((p, index) =>
      button(
        p.label,
        index % 2 ? 0.32 : -0.32,
        0.2 - Math.floor(index / 2) * 0.2,
        () => {
          draft = structuredClone(p.defaultAppearance!);
          status(`Selected: ${p.label} - Apply to save`);
        },
      ),
    );
  button("Apply", -0.32, -0.28, () => {
    const attempt = generation;
    const finish = (message: string) => {
      if (active && generation === attempt) status(message);
    };
    busy = true;
    status("Saving...");
    void apply(draft)
      .then(
        () => finish("Saved"),
        () => finish("Save failed - reload outside VR"),
      )
      .finally(() => {
        busy = false;
      });
  });
  button("Revert", 0.32, -0.28, () => {
    draft = current();
    status("Reverted to current saved look");
  });
  const calibration = (detail: Record<string, unknown>, message: string) => {
    scene.emit("avatar-calibration", detail, false);
    status(message);
  };
  button("Standing", -0.32, -0.5, () =>
    calibration({ posture: "standing" }, "Standing - Calibrate while upright"),
  );
  button("Seated", 0.32, -0.5, () =>
    calibration(
      { posture: "seated" },
      "Seated - standing size retained (default 1.64m)",
    ),
  );
  button("Calibrate", -0.32, -0.72, () =>
    calibration(
      { calibrate: true },
      "Height calibrated - stand to measure stature",
    ),
  );
  button("Size -", 0.32, -0.72, () =>
    calibration(
      { heightDelta: -0.05 },
      "Standing eye height -0.05m (session only)",
    ),
  );
  button("Size +", -0.32, -0.94, () =>
    calibration(
      { heightDelta: 0.05 },
      "Standing eye height +0.05m (session only)",
    ),
  );
  scene.append(panel);
  const pointers: any[] = [];
  for (const hand of ["left", "right"]) {
    const ray = document.createElement("a-entity");
    ray.setAttribute("laser-controls", `hand: ${hand}`);
    ray.setAttribute(
      "raycaster",
      "objects: .avatar-xr-action; far: 5; enabled: false",
    );
    (scene.querySelector("#avatar-xr-origin") ?? scene).append(ray);
    pointers.push(ray);
  }
  const gaze: any = document.createElement("a-cursor");
  gaze.setAttribute("fuse", "true");
  gaze.setAttribute("fuse-timeout", "1200");
  gaze.setAttribute(
    "raycaster",
    "objects: .avatar-xr-action; far: 5; enabled: false",
  );
  scene.querySelector("#camera")?.append(gaze);
  function setInteraction(enabled: boolean) {
    for (const input of [...pointers, gaze]) {
      input.setAttribute("raycaster", "enabled", enabled);
      input.setAttribute("visible", enabled);
      if (enabled) input.play();
      else {
        // Bundled cursor.pause only removes listeners; this API also cancels its fuse.
        input.components?.cursor?.clearCurrentIntersection(true);
        input.pause();
      }
    }
  }
  setInteraction(false);
  function place(head?: { position: number[]; orientation: number[] }) {
    const THREE = (window as any).AFRAME.THREE,
      camera = scene.camera;
    const position = head
      ? new THREE.Vector3().fromArray(head.position)
      : camera.getWorldPosition(new THREE.Vector3());
    const quaternion = head
      ? new THREE.Quaternion().fromArray(head.orientation)
      : camera.getWorldQuaternion(new THREE.Quaternion());
    const offset = new THREE.Vector3(0, -0.15, -1.8).applyQuaternion(
      quaternion,
    );
    panel.object3D.position.copy(position.add(offset));
    panel.object3D.quaternion.copy(quaternion);
  }
  const originChanged = (event: any) => {
    if (active) place(event.detail?.head);
  };
  const enter = () => {
    active = true;
    generation++;
    draft = current();
    status("My avatar - select, Apply or Revert");
    place();
    panel.setAttribute("visible", "true");
    setInteraction(true);
  };
  const exit = () => {
    active = false;
    generation++;
    panel.setAttribute("visible", "false");
    setInteraction(false);
  };
  scene.addEventListener("enter-vr", enter);
  scene.addEventListener("exit-vr", exit);
  scene.addEventListener("avatar-xr-origin-changed", originChanged);
  return () => {
    exit();
    scene.removeEventListener("enter-vr", enter);
    scene.removeEventListener("exit-vr", exit);
    scene.removeEventListener("avatar-xr-origin-changed", originChanged);
    panel.remove();
    gaze.remove();
    pointers.forEach((p) => p.remove());
  };
}
