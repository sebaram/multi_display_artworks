import type { WallLookV1 } from "../../wall-engine/types";
export function createHistory(initial: WallLookV1) {
  let current = structuredClone(initial),
    past: WallLookV1[] = [],
    future: WallLookV1[] = [];
  return {
    record(next: WallLookV1) {
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      past.push(current);
      if (past.length > 40) past.shift();
      current = structuredClone(next);
      future = [];
    },
    undo() {
      if (past.length) {
        future.push(current);
        current = past.pop()!;
      }
      return structuredClone(current);
    },
    redo() {
      if (future.length) {
        past.push(current);
        current = future.pop()!;
      }
      return structuredClone(current);
    },
    get canUndo() {
      return !!past.length;
    },
    get canRedo() {
      return !!future.length;
    },
  };
}
export async function replaceDraft<T>(
  draft: T,
  action: () => Promise<unknown>,
) {
  try {
    await action();
    return { draft, error: "" };
  } catch (error) {
    return {
      draft,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
import {
  patchElement,
  patchLayer,
  presetEdits,
} from "../../wall-engine/index.js";
import type { SourceState, WallElement } from "../../wall-engine/types";
export function moveSelection(
  state: SourceState,
  elements: WallElement[],
  ids: string[],
  dx: number,
  dy: number,
): SourceState {
  return ids.reduce((s, id) => {
    if (id.startsWith("media:")) {
      const layer = s.videoLayers.find((v) => v.id === id.slice(6));
      return layer
        ? patchLayer(s, layer.id, {
            x: (layer.x ?? 50) + dx,
            y: (layer.y ?? 50) + dy,
          })
        : s;
    }
    const e = elements.find((item) => item.id === id);
    return e
      ? patchElement(s, id, { x: (e.x ?? 50) + dx, y: (e.y ?? 50) + dy })
      : s;
  }, state);
}
export function reorderCustom(
  state: SourceState,
  id: string,
  delta: number,
): SourceState {
  const preset = presetEdits(state),
    index = preset.objects.findIndex((o) => o.id === id),
    next = Math.max(0, Math.min(preset.objects.length - 1, index + delta));
  if (index < 0 || next === index) return state;
  const objects = [...preset.objects];
  const [item] = objects.splice(index, 1);
  objects.splice(next, 0, item);
  return {
    ...state,
    authored: { ...state.authored, [state.variant]: { ...preset, objects } },
  };
}
