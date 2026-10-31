import { useId } from 'react';
import {
  DEFAULT_GAZE_CONFIG, GAZE_NUMERIC_LIMITS, GAZE_WEIGHT_KEYS, normalizeGazeConfig,
  type GazeConfig,
} from '../../avatar/gaze';
import './gaze-lab.css';

type NumericKey = Exclude<keyof GazeConfig, 'version' | 'mode' | 'weights'>;
const numericLabels: Record<NumericKey, string> = {
  coneDegrees: '시야각 전체 너비 (°)', maxDistance: '최대 거리 (m)',
  minFixationMs: '최소 응시 시간 (ms)', maxFixationMs: '최대 응시 시간 (ms)',
  switchMargin: '대상 전환 점수 차', lostHoldMs: '대상 소실 유예 (ms)',
  smoothingMs: '평활화 시간 상수 (ms)', maxSpeedDegrees: '최대 각속도 (°/s)',
  maxYawDegrees: '좌우 눈 회전 한계 (°)', maxPitchDegrees: '상하 눈 회전 한계 (°)',
  seed: '난수 시드', exploration: '탐색 확률 (0–1)',
};
const weightLabels: Record<keyof GazeConfig['weights'], string> = {
  center: '중앙 · center', proximity: '가까움 · proximity', person: '사람 · person',
  speaking: '발화 · speaking', interaction: '상호작용 · interaction',
  motion: '움직임 · motion', salience: '현저성 · salience', novelty: '새로움 · novelty',
};

/** Shared by the local experiment and the owner-scoped avatar editor. */
export function GazeControls({ config, onChange, disabled = false }: {
  config: GazeConfig; onChange(config: GazeConfig): void; disabled?: boolean;
}) {
  const id = useId();
  const patch = (value: Partial<GazeConfig>) => onChange(normalizeGazeConfig({ ...config, ...value }, true));
  const numeric = (key: NumericKey) => {
    const [lower, upper, step] = GAZE_NUMERIC_LIMITS[key];
    const min = key === 'maxFixationMs' ? Math.max(lower, config.minFixationMs) : lower;
    const max = key === 'minFixationMs' ? Math.min(upper, config.maxFixationMs) : upper;
    return <label key={key} htmlFor={`${id}-${key}`}>{numericLabels[key]}
      <input id={`${id}-${key}`} type="number" min={min} max={max} step={step} value={config[key]}
        onChange={event => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) patch({ [key]: Math.max(min, Math.min(max, key === 'seed' ? Math.trunc(value) : value)) });
        }} />
    </label>;
  };
  return <fieldset disabled={disabled} className="gaze-controls">
    <legend className="gaze-sr-only">절차적 시선 설정</legend>
    <label htmlFor={`${id}-mode`}>선택 조건
      <select id={`${id}-mode`} value={config.mode} onChange={event => patch({ mode: event.target.value as GazeConfig['mode'] })}>
        <option value="forward">Forward · 정면 고정</option>
        <option value="nearest">Nearest · 가장 가까운 대상</option>
        <option value="weighted">Weighted · 가중 점수</option>
      </select>
    </label>
    <div className="gaze-presets" aria-label="실험 프리셋">
      <button type="button" onClick={() => onChange(normalizeGazeConfig(DEFAULT_GAZE_CONFIG, true))}>기본값</button>
      <button type="button" onClick={() => patch({ smoothingMs: 0 })}>평활화 끄기</button>
      <button type="button" onClick={() => patch({ weights: { ...config.weights, person: 0, speaking: 0, interaction: 0 } })}>사회적 신호 제외</button>
    </div>
    <p className="gaze-help">설정 변경 시 선택·필터·난수 상태를 초기화합니다. 평활화를 꺼도 각속도 한계는 적용됩니다.</p>
    <details>
      <summary>대상 선택 · 시야각 {config.coneDegrees}°</summary>
      <div className="gaze-fields">{(['coneDegrees', 'maxDistance', 'seed', 'exploration'] as const).map(numeric)}</div>
    </details>
    <details>
      <summary>응시 시간과 전환 · {config.minFixationMs}–{config.maxFixationMs} ms</summary>
      <div className="gaze-fields">{(['minFixationMs', 'maxFixationMs', 'switchMargin', 'lostHoldMs'] as const).map(numeric)}</div>
    </details>
    <details>
      <summary>평활화와 회전 한계 · τ {config.smoothingMs} ms</summary>
      <div className="gaze-fields">{(['smoothingMs', 'maxSpeedDegrees', 'maxYawDegrees', 'maxPitchDegrees'] as const).map(numeric)}</div>
    </details>
    <details>
      <summary>주의 가중치 · 8개 신호</summary>
      <p className="gaze-help">Weighted 조건에 적용됩니다. 각 가중치는 0–10이며, 장면에 없는 신호는 0입니다.</p>
      <div className="gaze-fields">{GAZE_WEIGHT_KEYS.map(key => <label key={key} htmlFor={`${id}-weight-${key}`}>
        {weightLabels[key]}
        <input id={`${id}-weight-${key}`} type="number" min="0" max="10" step="0.05" value={config.weights[key]}
          onChange={event => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) patch({ weights: { ...config.weights, [key]: Math.max(0, Math.min(10, value)) } });
          }} />
      </label>)}</div>
    </details>
  </fieldset>;
}
