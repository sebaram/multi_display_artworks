import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ listeners: {} as Record<string, (value?: any) => void>, io: vi.fn() }));
vi.mock("socket.io-client", () => ({ io: state.io }));
import { startWallDisplay } from "../../src/scene/wall-display";
let socket: any;
beforeEach(() => {
  state.listeners = {};
  socket = {
    on(event: string, callback: (value?: any) => void) { state.listeners[event] = callback; return this; },
    timeout() { return this; }, emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn(),
  };
  state.io.mockReset().mockReturnValue(socket);
});
it("subscribes only to its wall and cannot send room input or playback commands", () => {
  const receive = vi.fn();
  const display = startWallDisplay("w", receive)!;
  state.listeners.connect();
  expect(socket.emit).toHaveBeenCalledWith("wall.watch", { wall_id: "w" }, expect.any(Function));
  receive.mockClear();
  state.listeners["wall.playback_state"]({ wall_id: "other", revision: 1 });
  expect(receive).not.toHaveBeenCalled();
  state.listeners["wall.playback_state"]({ wall_id: "w", revision: 2 });
  expect(receive).toHaveBeenLastCalledWith("wall.playback_state", { wall_id: "w", revision: 2 });
  state.listeners["wall.snapshot"]({ walls: [{ design: { wall_id: "other" } }, { design: { wall_id: "w" } }] });
  expect(receive.mock.lastCall![1].walls).toEqual([{ design: { wall_id: "w" } }]);
  socket.emit.mockClear();
  expect(display.client.request("wall.playback_command", {}, () => {})).toBe(false);
  display.client.emit();
  expect(socket.emit).not.toHaveBeenCalled();
  expect(display.client.request("wall.clock", {}, () => {})).toBe(true);
  expect(socket.emit).toHaveBeenCalledWith("wall.clock", {}, expect.any(Function));
  display.dispose();
});
it("disconnects on cancellation and ignores late server events", () => {
  const abort = new AbortController(), receive = vi.fn();
  startWallDisplay("w", receive, abort.signal);
  abort.abort();
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  state.listeners["wall.playback_state"]({ wall_id: "w" });
  state.listeners.connect();
  expect(receive).not.toHaveBeenCalled();
  expect(startWallDisplay("w", receive, abort.signal)).toBeUndefined();
  expect(state.io).toHaveBeenCalledTimes(1);
});
