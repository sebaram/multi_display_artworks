export function normalizeAppearance(input, catalog) {
  const preset = catalog.presets.find(p => p.id === (input?.presetId ?? input?.avatarId))
    ?? catalog.presets.find(p => p.id === 'shiba');
  const source = preset.defaultAppearance ?? {
    ...catalog.presets.find(p => p.defaultAppearance).defaultAppearance,
    faceId: 'none', hairId: 'none', hatId: 'none', glassesId: 'none',
  };
  const colors = Object.fromEntries(Object.entries(source.colors).map(([slot, fallback]) => {
    const value = input?.colors?.[slot] ?? (slot === 'top' ? input?.color : null);
    return [slot, /^#[0-9a-f]{6}$/i.test(value ?? '') ? value.toUpperCase() : fallback];
  }));
  const result = { schemaVersion: 2, presetId: preset.id, colors };
  for (const key of ['faceId', 'hairId', 'hatId', 'glassesId']) {
    result[key] = (preset.options?.[key] ?? ['none']).includes(input?.[key]) ? input[key] : source[key];
  }
  if (result.hatId === 'cap') result.hairId = 'none';
  return result;
}
