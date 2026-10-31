import type { AvatarCatalog, AvatarPreset } from "./types";
import { installAvatarCatalog } from "../scene/legacy/avatar-catalog.js";
import { translate as t } from "../app/i18n";

export function displayAvatarPreset(preset: AvatarPreset): string {
  const names: Record<string, [string, string]> = {
    casual: ["캐주얼", "Casual"],
    sporty: ["스포티", "Sporty"],
    explorer: ["탐험가", "Explorer"],
    "humanoid-robot": ["휴머노이드 로봇", "Humanoid Robot"],
    shiba: ["시바견", "Shiba"],
    robot: ["로봇", "Robot"],
    "rigged-simple": ["기본 리깅 모델", "Rigged Simple"],
    none: ["없음", "None"],
    "gaussian-306": [
      "GaussianAvatars 306 · 로컬 연구용 상체",
      "GaussianAvatars 306 · Local research bust",
    ],
  };
  const pair = names[preset.id];
  return pair ? t(...pair) : preset.label;
}
const canonical = new Map<string, AvatarPreset>();
let request: Promise<AvatarCatalog> | undefined;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function loadAvatarCatalog(): Promise<AvatarCatalog> {
  return (request ??= fetch("/api/v1/avatars/catalog", {
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) throw Error("Avatar catalog unavailable");
      const catalog: AvatarCatalog = await response.json();
      if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.presets))
        throw Error("Unsupported avatar catalog");
      freeze(catalog);
      for (const preset of catalog.presets) canonical.set(preset.id, preset);
      installAvatarCatalog(catalog);
      return catalog;
    })
    .catch((error) => {
      request = undefined;
      throw error;
    }));
}
/** Always resolve asset paths from the server catalog, ignoring caller URLs. */
export async function canonicalPreset(id: string) {
  await loadAvatarCatalog();
  const preset = canonical.get(id);
  if (!preset || preset.kind !== "humanoid")
    throw Error("Unknown humanoid preset");
  return preset;
}
