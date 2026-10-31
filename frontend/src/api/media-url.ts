export function safeMediaUrl(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
