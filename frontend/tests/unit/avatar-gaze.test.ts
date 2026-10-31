import { describe, expect, it } from 'vitest';
import { createGazeController, normalizeGazeConfig, type GazeConfig, type GazeTarget } from '../../src/avatar/gaze';
import type { Transform } from '../../src/avatar/types';

const head: Transform = { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
const target = (id: string, x = 0, y = 0, z = -3): GazeTarget => ({ id, position: [x, y, z], kind: 'marker' });
const speakingOnly = { center: 0, proximity: 0, person: 0, speaking: 1, interaction: 0, motion: 0, salience: 0, novelty: 0 };
const config = (input: Partial<GazeConfig> = {}) => normalizeGazeConfig(input);

describe('procedural gaze', () => {
  it('uses a total head-local cone and positive yaw/pitch toward +X/+Y', () => {
    const gaze = createGazeController(config({ mode: 'nearest', smoothingMs: 0, maxSpeedDegrees: 720 }));
    const targets = [target('behind', 0, 0, 1), target('outside', 2, 0, -3), target('inside', 0.6, 0.3, -3)];
    expect(gaze.step({ time: 0, head, targets }).scores.map(s => s.id)).toEqual(['inside']);
    const aimed = gaze.step({ time: 100, head, targets });
    expect(aimed.yaw).toBeCloseTo(0.19739556, 6);
    expect(aimed.pitch).toBeGreaterThan(0);
    const turned: Transform = { position: [2, 1, 0], orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
    const straight = gaze.step({ time: 200, head: turned, targets: [target('local-forward', -1, 1, 0)], reset: true });
    expect(straight.targetId).toBe('local-forward');
    expect(straight.scores[0].angleDegrees).toBeCloseTo(0, 5);
  });

  it('lets speaking win only after minimum fixation and the switching margin', () => {
    const gaze = createGazeController(config({ weights: speakingOnly, switchMargin: 0.15 }));
    const a = { ...target('a'), speaking: 0.5 }, b = { ...target('b', 0.3), speaking: 0.4 };
    expect(gaze.step({ time: 0, head, targets: [a, b] }).targetId).toBe('a');
    expect(gaze.step({ time: 500, head, targets: [a, { ...b, speaking: 1 }] }).targetId).toBe('a');
    expect(gaze.step({ time: 600, head, targets: [a, { ...b, speaking: 0.6 }] }).targetId).toBe('a');
    expect(gaze.step({ time: 700, head, targets: [a, { ...b, speaking: 0.8 }] }).targetId).toBe('b');
  });

  it('releases an invisible or deleted target after grace even during minimum fixation', () => {
    const gaze = createGazeController(config({ minFixationMs: 3000, lostHoldMs: 200 }));
    const a = target('a', 0.5);
    expect(gaze.step({ time: 0, head, targets: [a] }).targetId).toBe('a');
    expect(gaze.step({ time: 100, head, targets: [{ ...a, visible: false }] }).targetId).toBe('a');
    expect(gaze.step({ time: 299, head, targets: [] }).targetId).toBe('a');
    expect(gaze.step({ time: 300, head, targets: [] }).targetId).toBeNull();
    gaze.reset();
    gaze.step({ time: 0, head, targets: [a] });
    gaze.step({ time: 100, head, targets: [target('a', 4)] });
    expect(gaze.step({ time: 300, head, targets: [target('a', 4)] }).targetId).toBeNull();
  });

  it('ends maximum fixation by considering the best alternative without a sticky score lock', () => {
    const gaze = createGazeController(config({ weights: speakingOnly, minFixationMs: 0, maxFixationMs: 1000 }));
    const targets = [{ ...target('a'), speaking: 1 }, target('b')];
    gaze.step({ time: 0, head, targets });
    expect(gaze.step({ time: 1000, head, targets }).targetId).toBe('b');
    const single = createGazeController(config({ minFixationMs: 0, maxFixationMs: 100 }));
    single.step({ time: 0, head, targets: [target('a')] });
    expect(single.step({ time: 100, head, targets: [target('a')] }).targetId).toBeNull();
  });

  it('selects at 10Hz while filtering and tracking the selected target every frame', () => {
    const gaze = createGazeController(config({ mode: 'nearest', minFixationMs: 0, switchMargin: 0, smoothingMs: 0, maxSpeedDegrees: 720 }));
    gaze.step({ time: 0, head, targets: [target('a'), target('b', 0, 0, -4)] });
    const moved = [target('a', 0.3), target('b', 0, 0, -1)];
    const before = gaze.step({ time: 50, head, targets: moved });
    expect(before.targetId).toBe('a');
    expect(before.yaw).toBeGreaterThan(0);
    expect(gaze.step({ time: 100, head, targets: moved }).targetId).toBe('b');
  });

  it('uses elapsed milliseconds for frame-independent smoothing and vector speed bounds', () => {
    const targets = [target('a', 0.9, 0.3)];
    const run = (dt: number, smoothingMs: number, maxSpeedDegrees: number) => {
      const gaze = createGazeController(config({ smoothingMs, maxSpeedDegrees }));
      gaze.step({ time: 0, head, targets });
      let last = { yaw: 0, pitch: 0 };
      for (let time = dt; time <= 1000; time += dt) {
        const next = gaze.step({ time, head, targets });
        expect(Math.hypot(next.yaw - last.yaw, next.pitch - last.pitch)).toBeLessThanOrEqual(maxSpeedDegrees * Math.PI / 180 * dt / 1000 + 1e-10);
        last = next;
      }
      return last;
    };
    const fast = run(10, 150, 720), slow = run(20, 150, 720);
    expect(fast.yaw).toBeCloseTo(slow.yaw, 10);
    expect(fast.pitch).toBeCloseTo(slow.pitch, 10);
    expect(Math.hypot(run(10, 0, 10).yaw, run(10, 0, 10).pitch)).toBeCloseTo(Math.PI / 18, 8);
  });

  it('resets angles on long pauses, backward clocks and explicit teleport resets', () => {
    const gaze = createGazeController(config({ smoothingMs: 0, maxSpeedDegrees: 720 }));
    const targets = [target('a', 1)];
    gaze.step({ time: 0, head, targets });
    expect(gaze.step({ time: 100, head, targets }).yaw).toBeGreaterThan(0);
    expect(gaze.step({ time: 1200, head, targets }).yaw).toBe(0);
    expect(gaze.step({ time: 1300, head, targets }).yaw).toBeGreaterThan(0);
    expect(gaze.step({ time: 1250, head, targets }).yaw).toBe(0);
    expect(gaze.step({ time: 1350, head, targets, reset: true }).yaw).toBe(0);
  });

  it('breaks ties by stable ID and repeats exploration for the same seed', () => {
    const targets = [target('z'), target('a'), target('m')];
    const tied = createGazeController(config({ weights: speakingOnly }));
    expect(tied.step({ time: 0, head, targets }).targetId).toBe('a');
    const run = (seed: number) => {
      const gaze = createGazeController(config({ seed, exploration: 1, minFixationMs: 0, maxFixationMs: 100, weights: speakingOnly }));
      return Array.from({ length: 12 }, (_, i) => gaze.step({ time: i * 100, head, targets: i % 2 ? [...targets].reverse() : targets }).targetId);
    };
    expect(run(17)).toEqual(run(17));
    expect(run(17)).not.toEqual(run(18));
  });

  it('allows seeded exploration after minimum dwell even when an alternative scores lower', () => {
    const gaze = createGazeController(config({ seed: 17, exploration: 1, minFixationMs: 0, switchMargin: 1, weights: speakingOnly }));
    const a = { ...target('a'), speaking: 1 }, b = target('b');
    gaze.step({ time: 0, head, targets: [a] });
    const selected = Array.from({ length: 12 }, (_, i) => gaze.step({ time: (i + 1) * 100, head, targets: [a, b] }).targetId);
    expect(selected).toContain('b');
  });

  it('validates imported config and tolerantly canonicalizes stored settings', () => {
    expect(() => normalizeGazeConfig({ mystery: true }, true)).toThrow();
    for (const bad of [null, [], new Date(), { seed: 1.5 }, { mode: 'eyes' }, { smoothingMs: NaN }, { weights: { speaking: Infinity } }, { weights: { mystery: 1 } }, { minFixationMs: 3000, maxFixationMs: 1000 }]) {
      expect(() => normalizeGazeConfig(bad, true)).toThrow();
    }
    expect(normalizeGazeConfig({ coneDegrees: 999, maxDistance: '4', minFixationMs: 3000, maxFixationMs: 1000, weights: { speaking: 99 } })).toMatchObject({ coneDegrees: 160, maxDistance: 15, minFixationMs: 1000, maxFixationMs: 1000, weights: { speaking: 10 } });
    const gaze = createGazeController();
    gaze.configure({ mode: 'forward' });
    expect(gaze.step({ time: 0, head, targets: [target('a')] })).toMatchObject({ yaw: 0, pitch: 0, targetId: null });
  });

  it('bounds candidates and ignores malformed targets without poisoning outputs', () => {
    const gaze = createGazeController(config({ mode: 'nearest', smoothingMs: 0 }));
    const bad = [{ ...target('bad'), position: [NaN, 0, -1] }, { ...target('inf'), position: [0, 0, -Infinity] }, { ...target('hidden'), visible: false }, { ...target('zero'), position: [0, 0, 0] }];
    const targets = [...bad, ...Array.from({ length: 300 }, (_, i) => target(`valid-${i}`))] as GazeTarget[];
    const snapshot = gaze.step({ time: 0, head, targets });
    expect(snapshot.scores.length).toBeLessThanOrEqual(128);
    expect(snapshot.scores.every(s => s.id.startsWith('valid-') && Number.isFinite(s.score))).toBe(true);
    const hostile = gaze.step({ time: NaN, head: { position: [Infinity, 0, 0], orientation: [NaN, 0, 0, 0] }, targets: [null, { id: {}, position: [0, 0, -1] }] as unknown as GazeTarget[] });
    expect([hostile.yaw, hostile.pitch, hostile.time].every(Number.isFinite)).toBe(true);
    expect(hostile.targetId).toBeNull();
  });
});
