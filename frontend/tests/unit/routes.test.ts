import { it, expect } from "vitest";
import { legacyResource } from "../../src/app/routes";
it("preserves all legacy admin resource aliases", () => {
  expect(legacyResource("gaussiansplat")).toBe("splats");
  expect(legacyResource("llmconfig")).toBe("llm-configs");
  expect(legacyResource("locationpreset")).toBe("locations");
});
