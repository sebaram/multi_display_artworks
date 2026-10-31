export const LOCALE_STORAGE_KEY = "metamuseum.locale";
const supported = (value) => value === "ko" || value === "en";
const listeners = new Set();
function savedLocale() {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return supported(value) ? value : "ko";
  } catch {
    return "ko";
  }
}
let locale = savedLocale();
export const getLocale = () => locale;
function metadata() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.title =
    locale === "ko"
      ? "Meta Museum · 전시와 만남"
      : "Meta Museum · Exhibitions and encounters";
}
function update(value) {
  const changed = locale !== value;
  locale = value;
  metadata();
  if (changed) listeners.forEach((listener) => listener());
}
export function setLocale(value) {
  if (!supported(value)) return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    /* Switching still works when storage is restricted. */
  }
  update(value);
}
function storageChanged(event) {
  if (event.key === LOCALE_STORAGE_KEY || event.key === null)
    update(supported(event.newValue) ? event.newValue : "ko");
}
export function subscribeLocale(listener) {
  if (!listeners.size && typeof window !== "undefined")
    window.addEventListener("storage", storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", storageChanged);
  };
}
export function translate(ko, en, values) {
  const message = locale === "ko" ? ko : en;
  return values
    ? message.replace(/\{(\w+)\}/g, (token, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : token,
      )
    : message;
}
metadata();
