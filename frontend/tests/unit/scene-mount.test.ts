import { it, expect, vi } from "vitest";
import { mountRoom } from "../../src/scene/mountRoom";
it("removes the owned scene and callback on repeated dispose", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const dispose = vi.fn();
  const instance = mountRoom({
    container,
    bootstrap: {
      roomId: "test",
      walls: [],
      spawn_preset: null,
      boundary: {
        min_x: -2,
        max_x: 2,
        min_y: 0,
        max_y: 4,
        min_z: -2,
        max_z: 2,
      },
    } as any,
    services: { startRealtime: () => ({ dispose }), onSelect: vi.fn() },
  });
  instance.dispose();
  instance.dispose();
  expect(container.children).toHaveLength(0);
  container.remove();
});
