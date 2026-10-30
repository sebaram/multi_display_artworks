import type { AvatarCatalog, AvatarPreset } from './types';
import { installAvatarCatalog } from '../scene/legacy/avatar-catalog.js';
const canonical = new Map<string, AvatarPreset>();
let request: Promise<AvatarCatalog> | undefined;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function loadAvatarCatalog(): Promise<AvatarCatalog> {
  return request ??= fetch('/api/v1/avatars/catalog', { credentials: 'same-origin' }).then(async response => {
    if (!response.ok) throw Error('Avatar catalog unavailable');
    const catalog: AvatarCatalog = await response.json();
    if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.presets)) throw Error('Unsupported avatar catalog');
    freeze(catalog);
    for (const preset of catalog.presets) canonical.set(preset.id, preset);
    installAvatarCatalog(catalog);
    return catalog;
  }).catch(error => { request = undefined; throw error; });
}
/** Always resolve asset paths from the server catalog, ignoring caller URLs. */
export async function canonicalPreset(id: string) {
  await loadAvatarCatalog();
  const preset = canonical.get(id);
  if (!preset || preset.kind !== 'humanoid') throw Error('Unknown humanoid preset');
  return preset;
}
