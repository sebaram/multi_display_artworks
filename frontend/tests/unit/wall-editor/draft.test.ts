import { describe, it, expect } from "vitest";
import {
  createHistory,
  replaceDraft,
} from "../../../src/features/wall-editor/draft";
import {
  normalizeWallLook,
  addElement,
  patchElement,
  presetEdits,
} from "../../../src/wall-engine/index.js";

describe("wall draft", () => {
  it("undoes and redoes source edits without changing stable IDs", () => {
    const first = normalizeWallLook();
    const added = { ...first, state: addElement(first.state, "text") };
    const id = added.state.activeElement!;
    const changed = {
      ...added,
      state: patchElement(added.state, id, { ungrouped: true, x: 42 }),
    };
    const history = createHistory(added);
    history.record(changed);
    expect(presetEdits(history.undo().state).objects[0].id).toBe(id);
    expect(presetEdits(history.redo().state).objects[0]).toMatchObject({
      id,
      ungrouped: true,
      x: 42,
    });
  });
  it("keeps the draft when a save fails", async () => {
    const draft = normalizeWallLook();
    const state = await replaceDraft(draft, async () => {
      throw new Error("409");
    });
    expect(state.draft).toBe(draft);
    expect(state.error).toBe("409");
  });
});
import {
  moveSelection,
  reorderCustom,
} from "../../../src/features/wall-editor/draft";
describe("multi-selection", () => {
  it("moves selected source IDs independently without touching other objects", () => {
    let state = normalizeWallLook().state;
    state = addElement(state, "text");
    state = addElement(state, "text");
    const ids = presetEdits(state).objects.map((o) => o.id);
    const elements = ids.map((id, i) => ({
      id,
      name: id,
      parentId: null,
      depth: 0,
      custom: true,
      dom: true,
      text: true,
      mv: false,
      animated: false,
      base: {},
      x: 10 + i * 20,
      y: 20,
    }));
    const moved = moveSelection(state, elements, ids, 2, -1);
    expect(presetEdits(moved).objects.map((o) => [o.id, o.x, o.y])).toEqual([
      [ids[0], 12, 19],
      [ids[1], 32, 19],
    ]);
    expect(
      presetEdits(reorderCustom(moved, ids[1], -1)).objects.map((o) => o.id),
    ).toEqual([ids[1], ids[0]]);
  });
});
