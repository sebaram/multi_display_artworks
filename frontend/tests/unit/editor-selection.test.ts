import { it, expect } from "vitest";
import { createSelectionDraft } from "../../src/features/room/selection";
it("selects the second artwork and preserves failed save drafts", async () => {
  const editor = createSelectionDraft([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  editor.select("b");
  editor.patch({ name: "Changed" });
  await expect(
    editor.save(async () => {
      throw Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(editor.selected()).toMatchObject({ id: "b", name: "Changed" });
  expect(editor.dirty()).toBe(true);
});
