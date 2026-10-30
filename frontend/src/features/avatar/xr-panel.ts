import type { AvatarAppearanceV2, AvatarCatalog } from '../../avatar/types';

/** A-Frame controller rays and a gaze cursor keep this panel usable without a DOM overlay. */
export function mountAvatarXRPanel({ scene, catalog, current, apply }: {
  scene: any; catalog: AvatarCatalog; current(): AvatarAppearanceV2;
  apply(appearance: AvatarAppearanceV2): Promise<void>;
}) {
  const panel: any = document.createElement('a-entity'); panel.id = 'avatar-xr-panel';
  panel.setAttribute('visible', 'false');
  const background = document.createElement('a-plane');
  background.setAttribute('width', '1.35'); background.setAttribute('height', '1.1');
  background.setAttribute('color', '#17232f'); panel.append(background);
  let draft = current(), busy = false;
  const title = document.createElement('a-text');
  title.setAttribute('position', '-.6 .42 .01'); title.setAttribute('width', '1.9'); panel.append(title);
  const status = (text: string) => title.setAttribute('value', text);
  status('My avatar - select, Apply or Revert');
  function button(label: string, x: number, y: number, action: () => void) {
    const target = document.createElement('a-plane');
    target.classList.add('avatar-xr-action'); target.setAttribute('width', '.58'); target.setAttribute('height', '.16');
    target.setAttribute('position', `${x} ${y} .02`); target.setAttribute('color', '#36556b');
    const text = document.createElement('a-text'); text.setAttribute('value', label); text.setAttribute('align', 'center');
    text.setAttribute('width', '1.4'); text.setAttribute('position', '0 0 .01'); target.append(text);
    target.addEventListener('click', () => { if (!busy) action(); }); panel.append(target);
  }
  catalog.presets.filter(p => p.kind === 'humanoid').forEach((p, index) => button(p.label, index % 2 ? .32 : -.32, .2 - Math.floor(index / 2) * .2, () => {
    draft = structuredClone(p.defaultAppearance!); status(`Selected: ${p.label} - Apply to save`);
  }));
  button('Apply', -.32, -.28, () => {
    busy = true; status('Saving...');
    void apply(draft).then(() => status('Saved'), () => status('Save failed - reload outside VR')).finally(() => { busy = false; });
  });
  button('Revert', .32, -.28, () => { draft = current(); status('Reverted to current saved look'); });
  scene.append(panel);
  const pointers: Element[] = [];
  for (const hand of ['left', 'right']) {
    const ray = document.createElement('a-entity'); ray.setAttribute('laser-controls', `hand: ${hand}`);
    ray.setAttribute('raycaster', 'objects: .avatar-xr-action; far: 5'); scene.append(ray); pointers.push(ray);
  }
  const gaze = document.createElement('a-cursor'); gaze.setAttribute('fuse', 'true'); gaze.setAttribute('fuse-timeout', '1200');
  gaze.setAttribute('raycaster', 'objects: .avatar-xr-action; far: 5'); gaze.setAttribute('visible', 'false');
  scene.querySelector('#camera')?.append(gaze);
  const enter = () => {
    draft = current(); status('My avatar - select, Apply or Revert');
    const THREE = (window as any).AFRAME.THREE, camera = scene.camera;
    const position = camera.getWorldPosition(new THREE.Vector3());
    const quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const offset = new THREE.Vector3(0, -.15, -1.8).applyQuaternion(quaternion);
    panel.object3D.position.copy(position.add(offset));
    panel.object3D.quaternion.copy(quaternion);
    panel.setAttribute('visible', 'true'); gaze.setAttribute('visible', 'true');
  };
  const exit = () => { panel.setAttribute('visible', 'false'); gaze.setAttribute('visible', 'false'); };
  scene.addEventListener('enter-vr', enter); scene.addEventListener('exit-vr', exit);
  return () => { scene.removeEventListener('enter-vr', enter); scene.removeEventListener('exit-vr', exit); panel.remove(); gaze.remove(); pointers.forEach(p => p.remove()); };
}
