import type { DocumentDTO } from "../../api/types";
export function createSelectionDraft(items: DocumentDTO[]) {
  const drafts = new Map(items.map((i) => [i.id, { ...i }]));
  const changed = new Set<string>();
  let selectedId: string | null = null;
  return {
    select(id: string) {
      if (drafts.has(id)) selectedId = id;
    },
    selected() {
      return selectedId ? drafts.get(selectedId) : undefined;
    },
    patch(patch: Partial<DocumentDTO>) {
      if (!selectedId) return;
      drafts.set(selectedId, { ...drafts.get(selectedId)!, ...patch });
      changed.add(selectedId);
    },
    dirty() {
      return !!selectedId && changed.has(selectedId);
    },
    async save(save: (draft: DocumentDTO) => Promise<DocumentDTO>) {
      if (!selectedId) return;
      const id = selectedId;
      const saved = await save({ ...drafts.get(id)! });
      drafts.set(id, saved);
      changed.delete(id);
      return saved;
    },
  };
}
