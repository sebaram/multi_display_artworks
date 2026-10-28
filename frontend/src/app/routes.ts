const aliases: Record<string, string> = {
  room: "rooms",
  wall: "walls",
  image: "images",
  gaussiansplat: "splats",
  gltfmodel: "gltfs",
  webpage: "webpages",
  locationpreset: "locations",
  roomeffect: "effects",
  marker: "markers",
  mmmarkeradmin: "markers",
  llmconfig: "llm-configs",
  whisperconfig: "whisper-configs",
};
export function legacyResource(name: string) {
  return (
    aliases[name.toLowerCase().replaceAll("_", "").replaceAll("-", "")] ||
    name ||
    "rooms"
  );
}
