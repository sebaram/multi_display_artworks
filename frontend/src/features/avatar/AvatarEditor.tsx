import { useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarPreview } from './AvatarPreview';
import { normalizeAppearance } from '../../avatar/appearance';
import type { AvatarAppearanceV2, AvatarCatalog } from '../../avatar/types';
import { DEFAULT_GAZE_CONFIG } from '../../avatar/gaze';
import { GazeControls } from './GazeControls';
import { useI18n } from '../../app/i18n';
import { displayAvatarPreset } from '../../avatar/catalog';
import { LanguageSwitcher } from '../../app/LanguageSwitcher';
import './avatar-editor.css';
export type { SavedAvatar } from '../../api/types';

export function AvatarEditor({ catalog, initial, onApply, onReload, onClose }: {
  catalog: AvatarCatalog; initial: AvatarAppearanceV2;
  onApply(appearance: AvatarAppearanceV2): Promise<void>;
  onReload(): Promise<AvatarAppearanceV2>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const colorLabels: Record<string, string> = {
    skin: t('피부', 'Skin'), top: t('상의', 'Top'), bottom: t('하의', 'Bottom'),
    hair: t('머리카락', 'Hair'), eyes: t('눈', 'Eyes'),
  };
  const fieldLabels: Record<string, string> = {
    faceId: t('표정', 'Face'), hairId: t('머리 모양', 'Hairstyle'),
    hatId: t('모자', 'Hat'), glassesId: t('안경', 'Glasses'),
  };
  const optionLabels: Record<string, string> = {
    none: t('없음', 'None'), friendly: t('친근함', 'Friendly'), calm: t('차분함', 'Calm'),
    short: t('짧은 머리', 'Short'), cap: t('야구모자', 'Cap'), round: t('둥근 안경', 'Round'),
  };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const preset = catalog.presets.find(p => p.id === draft.presetId)!;
  const patch = (value: Partial<AvatarAppearanceV2>) => setDraft(normalizeAppearance({ ...draft, ...value }, catalog));
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (reason) {
      setError((reason as any).status === 409
        ? 'conflict'
        : 'connection');
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="avatar-editor" aria-label={t('내 아바타', 'My avatar')} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <h2>{t('내 아바타', 'My avatar')}</h2>
    <LanguageSwitcher />
    <fieldset disabled={busy} className="avatar-editor-form">
      <div className="avatar-editor-body">
        <div className="avatar-editor-preview">
          <AvatarPreview preset={preset} appearance={draft} />
          {preset.nativeGaussian && <p>{t('로컬 연구용 GaussianAvatars 머리·상체 샘플 · 원본 색상 사용', 'Local research GaussianAvatars head and torso sample · Original colors')}</p>}
        </div>
        <div className="avatar-editor-options">
      <label>{t('프리셋', 'Preset')} <select aria-label={t('아바타 프리셋', 'Avatar preset')} value={draft.presetId} onChange={e => setDraft(normalizeAppearance({ presetId: e.target.value, gaze: draft.gaze }, catalog))}>
        {catalog.presets.map(p => <option key={p.id} value={p.id}>{displayAvatarPreset(p)}</option>)}
      </select></label>
      <div className="avatar-editor-fields">
        {(preset.capabilities.colors ? (preset.kind === 'humanoid' ? ['skin', 'top', 'bottom', 'hair', 'eyes'] as const : ['top'] as const) : []).map(slot => <label key={slot}>
          {colorLabels[slot]}<input aria-label={t('{slot} 색상', '{slot} color', { slot: colorLabels[slot] })} type="color" value={draft.colors[slot]} onChange={e => patch({ colors: { ...draft.colors, [slot]: e.target.value } })} />
        </label>)}
        {Object.entries(preset.options).filter(([,options]) => options.length > 1).map(([field, options]) => <label key={field}>{fieldLabels[field] || field}<select aria-label={fieldLabels[field] || field} value={(draft as any)[field]} onChange={e => patch({ [field]: e.target.value })}>
          {options.map(option => <option key={option} value={option}>{optionLabels[option] || option}</option>)}
        </select></label>)}
      </div>
      {preset.kind === 'humanoid' && <details className="avatar-editor-gaze">
        <summary>{t('절차적 시선 실험', 'Procedural gaze experiment')}</summary>
        <p>{t('머리 방향과 주변 대상에서 추정합니다. 실제 눈 추적 값은 아닙니다.', 'Estimated from head direction and nearby targets; these are not actual eye tracking measurements.')}</p>
        <label><input type="checkbox" aria-label={t('절차적 시선 사용', 'Enable procedural gaze')} checked={!!draft.gaze}
          onChange={e => patch({ gaze: e.target.checked ? DEFAULT_GAZE_CONFIG : undefined })} /> {t('시선 알고리즘 사용', 'Use gaze algorithm')}</label>
        {draft.gaze && <GazeControls config={draft.gaze} onChange={gaze => patch({ gaze })} disabled={busy} />}
        <a href="/tools/gaze-lab" target="_blank" rel="noopener">{t('시선 실험실 열기 ↗', 'Open gaze lab ↗')}</a>
      </details>}
        </div>
      </div>
      <div className="avatar-editor-actions">
        <button className="primary" type="button" onClick={() => void perform(async () => { await onApply(draft); onClose(); })}>{busy ? t('저장 중…', 'Saving…') : t('적용', 'Apply')}</button>
        <button type="button" onClick={onClose}>{t('취소', 'Cancel')}</button>
        <button type="button" onClick={() => void perform(async () => setDraft(await onReload()))}>{t('저장된 외형 다시 불러오기', 'Reload saved appearance')}</button>
      </div>
    </fieldset>
    {error && <p className="avatar-editor-error" role="alert">{error === 'conflict'
      ? t('저장 충돌: 계정 또는 저장된 외형이 변경되었습니다. 저장된 외형을 다시 불러온 후 적용하세요.', 'Save conflict: your account or saved appearance changed. Reload saved appearance before applying again.')
      : t('적용하지 못했습니다. 연결을 확인하고 다시 시도하세요. 작성 중인 외형은 유지됩니다.', 'Unable to apply. Check your connection and retry. Your draft is kept.')}</p>}
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
