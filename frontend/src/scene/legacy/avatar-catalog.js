const riggedSimpleAssetUrl = '/static/gltf/rigged-simple/RiggedSimple.glb';

const shibaAssetUrl = '/static/gltf/shiba/scene.gltf';

export const AVATAR_CATALOG = {
  shiba: Object.freeze({
    label: 'Shiba',
    kind: 'gltf',
    assetUrl: shibaAssetUrl,
    attribution: 'Shiba by zixisun02 (CC BY 4.0)',
  }),
  robot: Object.freeze({
    label: 'Robot',
    kind: 'primitive',
  }),
  'rigged-simple': Object.freeze({
    label: 'Rigged Simple',
    kind: 'gltf',
    assetUrl: riggedSimpleAssetUrl,
    attribution: 'Rigged Simple by Cesium (CC BY 4.0)',
  }),
  none: Object.freeze({
    label: 'None',
    kind: 'none',
  }),
};

// The four entries above are the offline legacy fallback. New presets come only
// from the server catalog, which also replaces these descriptors when available.
export function installAvatarCatalog(catalog) {
  for (const preset of catalog.presets) AVATAR_CATALOG[preset.id] = preset;
}
