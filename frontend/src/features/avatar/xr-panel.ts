import type { AvatarAppearanceV2, AvatarCatalog } from "../../avatar/types";
import { translate as t, subscribeLocale } from "../../app/i18n";
import { displayAvatarPreset } from "../../avatar/catalog";

let labelId = 0;

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
  const assets = document.createElement("a-assets");
  scene.append(assets);
  const labelTextures: any[] = [];
  // The default a-text font has no Hangul. Canvas uses the device's system font.
  function createLabel(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.id = `avatar-xr-label-${++labelId}`;
    canvas.width = 1024;
    canvas.height = 256;
    assets.append(canvas);
    const plane: any = document.createElement("a-plane");
    plane.setAttribute("data-avatar-xr-label", "");
    plane.setAttribute("width", String(width));
    plane.setAttribute("height", String(height));
    plane.setAttribute("material", `shader: flat; src: #${canvas.id}; transparent: true; side: double; depthWrite: false`);
    labelTextures.push(plane);
    return {
      plane,
      update(value: string) {
        plane.setAttribute("aria-label", value);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = '112px sans-serif';
        const size = Math.min(112, 112 * 960 / Math.max(1, context.measureText(value).width));
        context.font = `${size}px sans-serif`;
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(value, canvas.width / 2, canvas.height / 2);
        const texture = plane.getObject3D?.("mesh")?.material?.map;
        if (texture) texture.needsUpdate = true;
      },
    };
  }
  const titleLabel = createLabel(1.2, .24);
  const title = titleLabel.plane;
  title.setAttribute("position", "0 .42 .01");
  panel.append(title);
  let statusLabel = () => t("내 아바타 - 선택 후 적용 또는 되돌리기", "My avatar - select, Apply or Revert");
  const status = (label: () => string) => {
    statusLabel = label;
    titleLabel.update(label());
  };
  status(statusLabel);
  const labelUpdates: (() => void)[] = [];
  function button(label: () => string, x: number, y: number, action: () => void) {
    const target = document.createElement("a-plane");
    target.classList.add("avatar-xr-action");
    target.setAttribute("width", ".58");
    target.setAttribute("height", ".16");
    target.setAttribute("position", `${x} ${y} .02`);
    target.setAttribute("color", "#36556b");
    const buttonLabel = createLabel(.54, .12);
    const text = buttonLabel.plane;
    const update = () => buttonLabel.update(label());
    update();
    labelUpdates.push(update);
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
        () => displayAvatarPreset(p),
        index % 2 ? 0.32 : -0.32,
        0.2 - Math.floor(index / 2) * 0.2,
        () => {
          draft = { ...structuredClone(p.defaultAppearance!), ...(draft.gaze ? { gaze: structuredClone(draft.gaze) } : {}) };
          status(() => t("선택: {name} - 적용하여 저장", "Selected: {name} - Apply to save", { name: displayAvatarPreset(p) }));
        },
      ),
    );
  button(() => t("적용", "Apply"), -0.32, -0.28, () => {
    const attempt = generation;
    const finish = (message: () => string) => {
      if (active && generation === attempt) status(message);
    };
    busy = true;
    status(() => t("저장 중…", "Saving..."));
    void apply(draft)
      .then(
        () => finish(() => t("저장했습니다", "Saved")),
        () => finish(() => t("저장 실패 - VR 밖에서 다시 불러오세요", "Save failed - reload outside VR")),
      )
      .finally(() => {
        busy = false;
      });
  });
  button(() => t("되돌리기", "Revert"), 0.32, -0.28, () => {
    draft = current();
    status(() => t("현재 저장된 외형으로 되돌렸습니다", "Reverted to current saved look"));
  });
  const calibration = (detail: Record<string, unknown>, message: () => string) => {
    scene.emit("avatar-calibration", detail, false);
    status(message);
  };
  button(() => t("서기", "Standing"), -0.32, -0.5, () =>
    calibration({ posture: "standing" }, () => t("서기 - 똑바로 선 상태에서 보정하세요", "Standing - Calibrate while upright")),
  );
  button(() => t("앉기", "Seated"), 0.32, -0.5, () =>
    calibration(
      { posture: "seated" },
      () => t("앉기 - 서 있을 때의 크기 유지 (기본 1.64m)", "Seated - standing size retained (default 1.64m)"),
    ),
  );
  button(() => t("보정", "Calibrate"), -0.32, -0.72, () =>
    calibration(
      { calibrate: true },
      () => t("높이 보정 완료 - 키를 측정하려면 서세요", "Height calibrated - stand to measure stature"),
    ),
  );
  button(() => t("크기 -", "Size -"), 0.32, -0.72, () =>
    calibration(
      { heightDelta: -0.05 },
      () => t("서 있을 때 눈높이 -0.05m (현재 세션만)", "Standing eye height -0.05m (session only)"),
    ),
  );
  button(() => t("크기 +", "Size +"), -0.32, -0.94, () =>
    calibration(
      { heightDelta: 0.05 },
      () => t("서 있을 때 눈높이 +0.05m (현재 세션만)", "Standing eye height +0.05m (session only)"),
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
    status(() => t("내 아바타 - 선택 후 적용 또는 되돌리기", "My avatar - select, Apply or Revert"));
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
  const unsubscribe = subscribeLocale(() => {
    labelUpdates.forEach(update => update());
    status(statusLabel);
  });
  return () => {
    unsubscribe();
    exit();
    scene.removeEventListener("enter-vr", enter);
    scene.removeEventListener("exit-vr", exit);
    scene.removeEventListener("avatar-xr-origin-changed", originChanged);
    labelTextures.forEach(label => label.getObject3D?.("mesh")?.material?.map?.dispose());
    assets.remove();
    panel.remove();
    gaze.remove();
    pointers.forEach((p) => p.remove());
  };
}
