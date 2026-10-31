import { useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarPreview } from './AvatarPreview';
import { normalizeAppearance } from '../../avatar/appearance';
import type { AvatarAppearanceV2, AvatarCatalog } from '../../avatar/types';
import { DEFAULT_GAZE_CONFIG } from '../../avatar/gaze';
import { GazeControls } from './GazeControls';
import './avatar-editor.css';
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
  return <dialog ref={dialog} className="avatar-editor" aria-label="My avatar" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <h2>My avatar</h2>
    <fieldset disabled={busy} className="avatar-editor-form">
      <div className="avatar-editor-body">
        <div className="avatar-editor-preview">
          <AvatarPreview preset={preset} appearance={draft} />
          {preset.nativeGaussian && <p>로컬 연구용 GaussianAvatars 머리·상체 샘플 · 원본 색상 사용</p>}
        </div>
        <div className="avatar-editor-options">
      <label>Preset <select aria-label="Avatar preset" value={draft.presetId} onChange={e => setDraft(normalizeAppearance({ presetId: e.target.value, gaze: draft.gaze }, catalog))}>
        {catalog.presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select></label>
      <div className="avatar-editor-fields">
        {(preset.capabilities.colors ? (preset.kind === 'humanoid' ? ['skin', 'top', 'bottom', 'hair', 'eyes'] as const : ['top'] as const) : []).map(slot => <label key={slot}>
          {slot}<input aria-label={`${slot} color`} type="color" value={draft.colors[slot]} onChange={e => patch({ colors: { ...draft.colors, [slot]: e.target.value } })} />
        </label>)}
        {Object.entries(preset.options).filter(([,options]) => options.length > 1).map(([field, options]) => <label key={field}>{field.replace('Id', '')}<select aria-label={field.replace('Id', '')} value={(draft as any)[field]} onChange={e => patch({ [field]: e.target.value })}>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select></label>)}
      </div>
      {preset.kind === 'humanoid' && <details className="avatar-editor-gaze">
        <summary>절차적 시선 실험</summary>
        <p>머리 방향과 주변 대상에서 추정합니다. 실제 눈 추적 값은 아닙니다.</p>
        <label><input type="checkbox" aria-label="Enable procedural gaze" checked={!!draft.gaze}
          onChange={e => patch({ gaze: e.target.checked ? DEFAULT_GAZE_CONFIG : undefined })} /> 시선 알고리즘 사용</label>
        {draft.gaze && <GazeControls config={draft.gaze} onChange={gaze => patch({ gaze })} disabled={busy} />}
        <a href="/tools/gaze-lab" target="_blank" rel="noopener">시선 실험실 열기 ↗</a>
      </details>}
        </div>
      </div>
      <div className="avatar-editor-actions">
        <button className="primary" type="button" onClick={() => void perform(async () => { await onApply(draft); onClose(); })}>{busy ? 'Saving…' : 'Apply'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => void perform(async () => setDraft(await onReload()))}>Reload saved appearance</button>
      </div>
    </fieldset>
    {error && <p className="avatar-editor-error" role="alert">{error}</p>}
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
