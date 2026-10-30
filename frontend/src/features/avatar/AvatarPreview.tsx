import { useEffect, useRef, useState } from 'react';
import { createAvatarInstance } from '../../avatar/resources';
import type { AvatarAppearanceV2, AvatarPreset, AvatarInstance } from '../../avatar/types';

export function AvatarPreview({ preset, appearance }: { preset: AvatarPreset; appearance: AvatarAppearanceV2 }) {
  const host = useRef<HTMLDivElement>(null), avatar = useRef<AvatarInstance | null>(null);
  const [error, setError] = useState('');
  const [rotation, setRotation] = useState(0), [zoom, setZoom] = useState(2.8);
  const controls = useRef({ rotation, zoom });
  const latest = useRef(appearance); latest.current = appearance;
  controls.current = { rotation, zoom };
  useEffect(() => { avatar.current?.applyAppearance(appearance); }, [appearance]);
  useEffect(() => {
    if (preset.kind !== 'humanoid') return;
    const THREE = (window as any).AFRAME?.THREE;
    if (!THREE || !host.current) { setError('Preview runtime unavailable'); return; }
    const controller = new AbortController();
    const world = new THREE.Scene();
    world.background = new THREE.Color('#dce4e8');
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 30);
    let renderer: any;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError('Preview unavailable: WebGL could not start'); return; }
    renderer.domElement.style.cssText = 'display:block;width:100%;height:260px;max-width:100%;';
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.current.append(renderer.domElement);
    world.add(new THREE.HemisphereLight(0xffffff, 0x596978, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(-2, 4, -3); world.add(light);
    const group = new THREE.Group(); world.add(group);
    setError('');
    void createAvatarInstance({ scene: group, preset, appearance, signal: controller.signal, renderer, aframeScene: world }).then(instance => {
      avatar.current = instance;
      instance.applyAppearance(latest.current);
    }).catch(reason => { if (!controller.signal.aborted) setError(`Preview unavailable: ${reason.message}`); });
    let frame = 0;
    const draw = () => {
      const width = host.current?.clientWidth || 300;
      renderer.setSize(width, 260, false);
      camera.aspect = width / 260; camera.updateProjectionMatrix();
      const distance = controls.current.zoom * (preset.nativeGaussian ? .35 : 1);
      const focusHeight = preset.nativeGaussian ? 1.6 : .92 + Math.max(0, Math.min(1, (2.8 - distance) / 1.4)) * .65;
      camera.position.set(0, focusHeight + .1, -distance); camera.lookAt(0, focusHeight, 0);
      group.rotation.y = controls.current.rotation * Math.PI / 180;
      renderer.render(world, camera); frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); controller.abort(); avatar.current?.dispose(); avatar.current = null;
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [preset.kind, preset.rigVersion, preset.assetUrl, preset.nativeGaussian]);
  return <section aria-label="Avatar preview">
    {preset.kind === 'humanoid' ? <div ref={host} style={{ height: 260, width: '100%' }} /> : <p>{preset.label} · Legacy avatar preview</p>}
    {error && <p role="status">{error} · Your saved appearance is kept. Try another preset or reload.</p>}
    <label>Rotate <input aria-label="Rotate preview" type="range" min="-180" max="180" value={rotation} onChange={e => setRotation(+e.target.value)} /></label>
    <label>Zoom <input aria-label="Zoom preview" type="range" min="1.4" max="4" step=".1" value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
  </section>;
}
