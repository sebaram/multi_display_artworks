export function animationTime(
  config: any,
  epochMs: number,
  serverNowMs: number,
) {
  const state = config?.state || config || {};
  const offset = Number(state.offset) || 0;
  return (
    offset +
    (state.paused
      ? 0
      : (Math.max(0, serverNowMs - epochMs) / 1000) *
        (Number.isFinite(Number(state.speed)) ? Number(state.speed) : 1))
  );
}
export function mediaTime(state: any, serverNowMs: number) {
  const rate = state.rate ?? 1;
  return {
    positionSeconds: Math.max(
      0,
      (state.position_seconds ?? state.positionSeconds ?? 0) +
        (state.playing
          ? (Math.max(0, serverNowMs - (state.state_time_ms ?? serverNowMs)) /
              1000) *
            rate
          : 0),
    ),
    playing: !!state.playing,
    rate,
  };
}
export function createServerClock() {
  let offset = 0;
  return {
    observe(serverTimeMs: number, receivedAt = Date.now()) {
      if (Number.isFinite(serverTimeMs)) offset = serverTimeMs - receivedAt;
    },
    now() {
      return Date.now() + offset;
    },
  };
}
