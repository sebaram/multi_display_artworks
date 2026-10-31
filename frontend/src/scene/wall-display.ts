import { io } from "socket.io-client";
import { translate as t } from '../app/i18n';

/** A display receives public wall state but never joins visitor presence. */
export function startWallDisplay(wallId: string, onEvent: (event: string, payload: any) => void,
  signal?: AbortSignal, onError?: (message: string) => void) {
  if (signal?.aborted) return;
  let disposed = false;
  const socket = io(location.origin, { autoConnect: false });
  const client = {
    emit() {},
    request(event: string, payload: unknown, acknowledge: (response: any) => void) {
      if (disposed || event !== "wall.clock") return false;
      socket.emit(event, payload, acknowledge);
      return true;
    },
  };
  socket.on("connect", () => {
    if (disposed) return;
    onEvent("connect", { client });
    socket.timeout(5000).emit("wall.watch", { wall_id: wallId }, (error: Error | null, reply: any) => {
      if (!disposed && (error || !reply?.ok)) onError?.(t('월 실시간 연결을 확인하세요.', 'Check the live wall connection.'));
    });
  });
  for (const event of ["wall.snapshot", "wall.design_applied", "wall.design_removed", "wall.interaction_state", "wall.playback_state"]) {
    socket.on(event, (payload: any) => {
      if (disposed) return;
      if (event === "wall.snapshot") {
        onEvent(event, { ...payload, walls: (payload?.walls || []).filter((entry: any) => entry.design?.wall_id === wallId) });
      } else if (payload?.wall_id === wallId) onEvent(event, payload);
    });
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    socket.removeAllListeners();
    socket.disconnect();
  };
  signal?.addEventListener("abort", dispose, { once: true });
  socket.connect();
  return { client, dispose };
}
