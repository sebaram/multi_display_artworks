import { it, expect, vi, afterEach } from "vitest";
import { createRoomEffects } from "../../src/scene/room-effects.js";
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
it("loads public active effects and removes them at expiration", async () => {
  vi.useFakeTimers();
  const scene = document.createElement("a-scene");
  document.body.append(scene);
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "effect",
          effect_type: "ambient",
          params: { color: "#88bbff", intensity: 0.6 },
          expires_at: new Date(Date.now() + 100).toISOString(),
        },
      ],
    });
  const effects = createRoomEffects({ document, fetch: fetcher, setTimeout });
  effects.init("room-a", {});
  await vi.waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/api/v1/rooms/room-a/effects"),
  );
  await vi.waitFor(()=>expect(document.getElementById("llm-ambient-light")).not.toBeNull());
  await vi.advanceTimersByTimeAsync(101);
  expect(document.getElementById("llm-ambient-light")).toBeNull();
  effects.destroy();
});
