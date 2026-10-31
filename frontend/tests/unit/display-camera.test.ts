import { afterEach, expect, it } from "vitest";
import { mountRoom } from "../../src/scene/mountRoom";

afterEach(() => document.body.replaceChildren());
it("fits the whole TV wall at landscape and portrait sizes without movement controls", () => {
  let width = 1920, height = 1080;
  const host = document.createElement("div"); document.body.append(host);
  host.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  const room = mountRoom({ container: host, bootstrap: {
    displayOnly: true, roomId: "r", spawn_preset: { position: "0 0 12" },
    walls: [{ id: "w", position: "0 0 0", rotation: "0 0 0", width: 10, height: 3, depth: .2, elements: [] }],
  } as any });
  const camera = host.querySelector("#camera")!;
  expect(camera.getAttribute("fov")).toBe("60");
  expect(camera.getAttribute("look-controls")).toContain("enabled: false");
  expect(camera.getAttribute("wasd-controls")).toContain("enabled: false");
  function coverage() {
    const z = Number(camera.getAttribute("position")!.split(" ")[2]) - .1;
    return [10 / (2*z*Math.tan(Math.PI/6)*(width/height)), 3 / (2*z*Math.tan(Math.PI/6))];
  }
  expect(coverage()[0]).toBeCloseTo(.98);
  width = 390; height = 844; window.dispatchEvent(new Event("resize"));
  expect(coverage()[0]).toBeCloseTo(.98);
  expect(coverage()[1]).toBeLessThan(1);
  room.dispose();
});
