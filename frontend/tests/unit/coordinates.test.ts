import { describe, it, expect } from "vitest";
import {
  localToWorld,
  worldToLocal,
  elementPosition,
} from "../../src/scene/coordinates";
describe("surface coordinates", () => {
  for (const rotation of ["0 90 0", "-90 0 0", "90 0 0", "23 41 18"])
    it(`roundtrips wall/floor/ceiling ${rotation}`, () => {
      const wall = { position: "3 2 -4", rotation };
      const p = { x: 1, y: 2, z: 0.1 };
      const result = worldToLocal(localToWorld(p, wall), wall);
      expect(result.x).toBeCloseTo(p.x);
      expect(result.y).toBeCloseTo(p.y);
      expect(result.z).toBeCloseTo(p.z);
    });
  it("retains floor artwork local coordinates", () =>
    expect(
      elementPosition(
        { position_x: 1, position_y: 2 },
        { surface_type: "floor", depth: 0.2 },
      ),
    ).toEqual({ x: 1, y: 2, z: 0.05 }));
  it("retains authored GLTF depth on a floor and on a vertical wall", () => {
    expect(
      elementPosition(
        { position_z: 0.23, wall_element_type: "gltf" },
        { surface_type: "floor", depth: 0.2 },
      ).z,
    ).toBe(0.23);
    expect(
      elementPosition(
        { position_z: 0.23, wall_element_type: "gltf" },
        { surface_type: "wall", depth: 0.2 },
      ).z,
    ).toBeCloseTo(0.43);
  });
});
