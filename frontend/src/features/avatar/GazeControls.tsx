import { useI18n } from "../../app/i18n";
import { useId } from "react";
import {
  DEFAULT_GAZE_CONFIG,
  GAZE_NUMERIC_LIMITS,
  GAZE_WEIGHT_KEYS,
  normalizeGazeConfig,
  type GazeConfig,
} from "../../avatar/gaze";
import "./gaze-lab.css";

type NumericKey = Exclude<keyof GazeConfig, "version" | "mode" | "weights">;
/** Shared by the local experiment and the owner-scoped avatar editor. */
export function GazeControls({
  config,
  onChange,
  disabled = false,
}: {
  config: GazeConfig;
  onChange(config: GazeConfig): void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const numericLabels: Record<NumericKey, string> = {
    coneDegrees: t("시야각 전체 너비 (°)", "Full field of view (°)"),
    maxDistance: t("최대 거리 (m)", "Maximum distance (m)"),
    minFixationMs: t("최소 응시 시간 (ms)", "Minimum fixation (ms)"),
    maxFixationMs: t("최대 응시 시간 (ms)", "Maximum fixation (ms)"),
    switchMargin: t("대상 전환 점수 차", "Target switch margin"),
    lostHoldMs: t("대상 소실 유예 (ms)", "Lost target hold (ms)"),
    smoothingMs: t("평활화 시간 상수 (ms)", "Smoothing time constant (ms)"),
    maxSpeedDegrees: t("최대 각속도 (°/s)", "Maximum angular speed (°/s)"),
    maxYawDegrees: t(
      "좌우 눈 회전 한계 (°)",
      "Horizontal eye rotation limit (°)",
    ),
    maxPitchDegrees: t(
      "상하 눈 회전 한계 (°)",
      "Vertical eye rotation limit (°)",
    ),
    seed: t("난수 시드", "Random seed"),
    exploration: t("탐색 확률 (0–1)", "Exploration probability (0–1)"),
  };
  const weightLabels: Record<keyof GazeConfig["weights"], string> = {
    center: t("중앙 · center", "Center"),
    proximity: t("가까움 · proximity", "Proximity"),
    person: t("사람 · person", "Person"),
    speaking: t("발화 · speaking", "Speaking"),
    interaction: t("상호작용 · interaction", "Interaction"),
    motion: t("움직임 · motion", "Motion"),
    salience: t("현저성 · salience", "Salience"),
    novelty: t("새로움 · novelty", "Novelty"),
  };

  const patch = (value: Partial<GazeConfig>) =>
    onChange(normalizeGazeConfig({ ...config, ...value }, true));
  const numeric = (key: NumericKey) => {
    const [lower, upper, step] = GAZE_NUMERIC_LIMITS[key];
    const min =
      key === "maxFixationMs" ? Math.max(lower, config.minFixationMs) : lower;
    const max =
      key === "minFixationMs" ? Math.min(upper, config.maxFixationMs) : upper;
    return (
      <label key={key} htmlFor={`${id}-${key}`}>
        {numericLabels[key]}
        <input
          id={`${id}-${key}`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={config[key]}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value))
              patch({
                [key]: Math.max(
                  min,
                  Math.min(max, key === "seed" ? Math.trunc(value) : value),
                ),
              });
          }}
        />
      </label>
    );
  };
  return (
    <fieldset disabled={disabled} className="gaze-controls">
      <legend className="gaze-sr-only">
        {t("절차적 시선 설정", "Procedural gaze settings")}
      </legend>
      <label htmlFor={`${id}-mode`}>
        {t("선택 조건", "Selection mode")}
        <select
          id={`${id}-mode`}
          value={config.mode}
          onChange={(event) =>
            patch({ mode: event.target.value as GazeConfig["mode"] })
          }
        >
          <option value="forward">
            {t("Forward · 정면 고정", "Forward · fixed ahead")}
          </option>
          <option value="nearest">
            {t("Nearest · 가장 가까운 대상", "Nearest · closest target")}
          </option>
          <option value="weighted">
            {t("Weighted · 가중 점수", "Weighted · weighted score")}
          </option>
        </select>
      </label>
      <div
        className="gaze-presets"
        aria-label={t("실험 프리셋", "Experiment presets")}
      >
        <button
          type="button"
          onClick={() =>
            onChange(normalizeGazeConfig(DEFAULT_GAZE_CONFIG, true))
          }
        >
          {t("기본값", "Defaults")}
        </button>
        <button type="button" onClick={() => patch({ smoothingMs: 0 })}>
          {t("평활화 끄기", "Disable smoothing")}
        </button>
        <button
          type="button"
          onClick={() =>
            patch({
              weights: {
                ...config.weights,
                person: 0,
                speaking: 0,
                interaction: 0,
              },
            })
          }
        >
          {t("사회적 신호 제외", "Exclude social signals")}
        </button>
      </div>
      <p className="gaze-help">
        {t(
          "설정 변경 시 선택·필터·난수 상태를 초기화합니다. 평활화를 꺼도 각속도 한계는 적용됩니다.",
          "Changing settings resets selection, filter and random state. Angular speed limits still apply when smoothing is disabled.",
        )}
      </p>
      <details>
        <summary>
          {t(
            "대상 선택 · 시야각 {angle}°",
            "Target selection · field of view {angle}°",
            { angle: config.coneDegrees },
          )}
        </summary>
        <div className="gaze-fields">
          {(["coneDegrees", "maxDistance", "seed", "exploration"] as const).map(
            numeric,
          )}
        </div>
      </details>
      <details>
        <summary>
          {t(
            "응시 시간과 전환 · {min}–{max} ms",
            "Fixation and switching · {min}–{max} ms",
            { min: config.minFixationMs, max: config.maxFixationMs },
          )}
        </summary>
        <div className="gaze-fields">
          {(
            [
              "minFixationMs",
              "maxFixationMs",
              "switchMargin",
              "lostHoldMs",
            ] as const
          ).map(numeric)}
        </div>
      </details>
      <details>
        <summary>
          {t(
            "평활화와 회전 한계 · τ {time} ms",
            "Smoothing and rotation limits · τ {time} ms",
            { time: config.smoothingMs },
          )}
        </summary>
        <div className="gaze-fields">
          {(
            [
              "smoothingMs",
              "maxSpeedDegrees",
              "maxYawDegrees",
              "maxPitchDegrees",
            ] as const
          ).map(numeric)}
        </div>
      </details>
      <details>
        <summary>
          {t("주의 가중치 · 8개 신호", "Attention weights · 8 signals")}
        </summary>
        <p className="gaze-help">
          {t(
            "Weighted 조건에 적용됩니다. 각 가중치는 0–10이며, 장면에 없는 신호는 0입니다.",
            "Applies to Weighted mode. Each weight is 0–10; signals absent from the scene are zero.",
          )}
        </p>
        <div className="gaze-fields">
          {GAZE_WEIGHT_KEYS.map((key) => (
            <label key={key} htmlFor={`${id}-weight-${key}`}>
              {weightLabels[key]}
              <input
                id={`${id}-weight-${key}`}
                type="number"
                min="0"
                max="10"
                step="0.05"
                value={config.weights[key]}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value))
                    patch({
                      weights: {
                        ...config.weights,
                        [key]: Math.max(0, Math.min(10, value)),
                      },
                    });
                }}
              />
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
