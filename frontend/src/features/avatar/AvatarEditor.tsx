import { useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarPreview } from './AvatarPreview';
import { normalizeAppearance } from '../../avatar/appearance';
import type { AvatarAppearanceV2, AvatarCatalog } from '../../avatar/types';
import { DEFAULT_GAZE_CONFIG } from '../../avatar/gaze';
import { GazeControls } from './GazeControls';
export type { SavedAvatar } from '../../api/types';

export function AvatarEditor({ catalog, initial, onApply, onReload, onClose }: {
  catalog: AvatarCatalog; initial: AvatarAppearanceV2;
  onApply(appearance: AvatarAppearanceV2): Promise<void>;
  onReload(): Promise<AvatarAppearanceV2>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const preset = catalog.presets.find(p => p.id === draft.presetId)!;
  const patch = (value: Partial<AvatarAppearanceV2>) => setDraft(normalizeAppearance({ ...draft, ...value }, catalog));
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (reason) {
      setError((reason as any).status === 409
        ? 'Save conflict: your account or saved appearance changed. Reload saved appearance before applying again.'
        : 'Unable to apply. Check your connection and retry. Your draft is kept.');
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-label="My avatar" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    style={{ width: 'min(620px, calc(100vw - 24px))', maxHeight: '90dvh', overflow: 'auto', boxSizing: 'border-box', border: 0, borderRadius: 14, padding: 20, background: '#17232f', color: '#fff' }}>
    <h2 style={{ margin: '0 0 12px' }}>My avatar</h2>
    <AvatarPreview preset={preset} appearance={draft} />
    {preset.nativeGaussian && <p>로컬 연구용 실제 GaussianAvatars 머리·상체 샘플입니다. 원본 색상을 사용하며, 팔·다리를 포함한 전신 모델은 아닙니다.</p>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <label>Preset <select aria-label="Avatar preset" value={draft.presetId} onChange={e => setDraft(normalizeAppearance({ presetId: e.target.value, gaze: draft.gaze }, catalog))}>
        {catalog.presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, margin: '12px 0' }}>
        {(preset.capabilities.colors ? (preset.kind === 'humanoid' ? ['skin', 'top', 'bottom', 'hair', 'eyes'] as const : ['top'] as const) : []).map(slot => <label key={slot}>
          {slot}<input aria-label={`${slot} color`} type="color" value={draft.colors[slot]} onChange={e => patch({ colors: { ...draft.colors, [slot]: e.target.value } })} style={{ width: '100%', height: 38 }} />
        </label>)}
        {Object.entries(preset.options).filter(([,options]) => options.length > 1).map(([field, options]) => <label key={field}>{field.replace('Id', '')}<select aria-label={field.replace('Id', '')} value={(draft as any)[field]} onChange={e => patch({ [field]: e.target.value })}>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select></label>)}
      </div>
      {preset.kind === 'humanoid' && <details>
        <summary>절차적 시선 실험</summary>
        <p>머리 방향과 주변 대상에서 추정합니다. 실제 눈 추적 값은 아닙니다.</p>
        <label><input type="checkbox" aria-label="Enable procedural gaze" checked={!!draft.gaze}
          onChange={e => patch({ gaze: e.target.checked ? DEFAULT_GAZE_CONFIG : undefined })} /> 시선 알고리즘 사용</label>
        {draft.gaze && <GazeControls config={draft.gaze} onChange={gaze => patch({ gaze })} disabled={busy} />}
        <a href="/tools/gaze-lab" target="_blank" rel="noopener">시선 실험실 열기 ↗</a>
      </details>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" type="button" onClick={() => void perform(async () => { await onApply(draft); onClose(); })}>{busy ? 'Saving…' : 'Apply'}</button>
        <button type="button" style={{ color: '#17232f' }} onClick={onClose}>Cancel</button>
        <button type="button" style={{ color: '#17232f' }} onClick={() => void perform(async () => setDraft(await onReload()))}>Reload saved appearance</button>
      </div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}

export function mountAvatarEditor(props: Parameters<typeof AvatarEditor>[0]) {
  const trigger = document.activeElement as HTMLElement | null;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const close = () => { root.unmount(); container.remove(); props.onClose(); if (trigger?.isConnected) trigger.focus(); };
  root.render(<AvatarEditor {...props} onClose={close} />);
  return close;
}
