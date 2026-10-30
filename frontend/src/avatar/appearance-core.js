export function validateParametric(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'betas,model'
      || !['smpl', 'smplx'].includes(value.model) || !Array.isArray(value.betas)
      || value.betas.length > 300 || value.betas.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 10)
      || JSON.stringify(value).length > 8192) throw Error('Invalid shape parameters: use smpl/smplx and at most 300 finite betas in [-10, 10] (8 KiB maximum).');
  return { model: value.model, betas: [...value.betas] };
}
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
  if (input?.parametric !== undefined) {
    try { result.parametric = validateParametric(input.parametric); } catch { /* Discard malformed untrusted profiles. */ }
  }
  return result;
}
