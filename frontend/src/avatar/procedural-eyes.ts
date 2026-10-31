import type { GazePose } from './types';

/** Diagnostic eyes for the existing CC0 humanoid, independent of GaussianAvatars. */
export function createProceduralEyes(THREE: any, anchor: any) {
  const root = new THREE.Group(); root.name = 'ProceduralEyes'; anchor.add(root);
  const geometry = new THREE.SphereGeometry(1, 10, 8);
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4ed', roughness: .65 });
  const iris = new THREE.MeshStandardMaterial({ color: '#292b34', roughness: .65 });
  const eyes = [-.05, .05].map(x => {
    const eye = new THREE.Group(); eye.position.set(x, .03, -.141); root.add(eye);
    const globe = new THREE.Mesh(geometry, white); globe.scale.setScalar(.025); eye.add(globe);
    const pupil = new THREE.Mesh(geometry, iris); pupil.position.z = -.023;
    pupil.scale.set(.0105, .0105, .005); eye.add(pupil);
    return eye;
  });
  let gaze: GazePose | undefined, visible = true;
  root.visible = false;
  return {
    apply(next?: GazePose) {
      gaze = next;
      // The model faces -Z, so positive physical yaw uses negative Three Y rotation.
      for (const eye of eyes) eye.rotation.set(next?.pitch ?? 0, -(next?.yaw ?? 0), 0, 'YXZ');
      root.visible = visible && !!gaze;
    },
    color(value: string) { iris.color.set(value); },
    visible(next: boolean) { visible = next; root.visible = next && !!gaze; },
    dispose() { root.removeFromParent(); geometry.dispose(); white.dispose(); iris.dispose(); },
  };
}
