import { useEffect, useRef, useState } from 'react';
import { createAvatarInstance } from '../../avatar/resources';
import type { AvatarAppearanceV2, AvatarPreset, AvatarInstance } from '../../avatar/types';
import { useI18n } from '../../app/i18n';
import { displayAvatarPreset } from '../../avatar/catalog';

export function AvatarPreview({ preset, appearance }: { preset: AvatarPreset; appearance: AvatarAppearanceV2 }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null), avatar = useRef<AvatarInstance | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [rotation, setRotation] = useState(0), [zoom, setZoom] = useState(2.8);
  const controls = useRef({ rotation, zoom });
  const latest = useRef(appearance); latest.current = appearance;
  controls.current = { rotation, zoom };
  useEffect(() => { avatar.current?.applyAppearance(appearance); }, [appearance]);
  useEffect(() => {
    if (preset.kind !== 'humanoid') return;
    const THREE = (window as any).AFRAME?.THREE;
    if (!THREE || !host.current) { setError('runtime'); return; }
    const controller = new AbortController();
    const world = new THREE.Scene();
    world.background = new THREE.Color('#dce4e8');
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 30);
    let renderer: any;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError('webgl'); return; }
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;max-width:100%;';
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.current.append(renderer.domElement);
    world.add(new THREE.HemisphereLight(0xffffff, 0x596978, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(-2, 4, -3); world.add(light);
    const group = new THREE.Group(); world.add(group);
    setError('');
    void createAvatarInstance({ scene: group, preset, appearance, signal: controller.signal, renderer, aframeScene: world }).then(instance => {
      avatar.current = instance;
      instance.applyAppearance(latest.current);
    }).catch(reason => { if (!controller.signal.aborted) { setError('load'); setDetail(reason.message); } });
    let frame = 0;
    const draw = () => {
      const width = host.current?.clientWidth || 300;
      const height = host.current?.clientHeight || 260;
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
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
  const errorMessage = error === 'runtime' ? t('미리보기 실행 환경을 사용할 수 없습니다', 'Preview runtime unavailable')
    : error === 'webgl' ? t('미리보기 불가: WebGL을 시작하지 못했습니다', 'Preview unavailable: WebGL could not start')
    : t('미리보기 불가: {detail}', 'Preview unavailable: {detail}', { detail });
  return <section aria-label={t('아바타 미리보기', 'Avatar preview')} className="avatar-preview">
    {preset.kind === 'humanoid' ? <div ref={host} className="avatar-preview-host" /> : <p>{displayAvatarPreset(preset)} · {t('기존 아바타 미리보기', 'Legacy avatar preview')}</p>}
    {error && <p role="status">{errorMessage} · {t('저장된 외형은 유지됩니다. 다른 프리셋을 선택하거나 다시 불러오세요.', 'Your saved appearance is kept. Try another preset or reload.')}</p>}
    <div className="avatar-preview-controls">
    <label>{t('회전', 'Rotate')} <input aria-label={t('미리보기 회전', 'Rotate preview')} type="range" min="-180" max="180" value={rotation} onChange={e => setRotation(+e.target.value)} /></label>
    <label>{t('확대', 'Zoom')} <input aria-label={t('미리보기 확대', 'Zoom preview')} type="range" min="1.4" max="4" step=".1" value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
    </div>
  </section>;
}
