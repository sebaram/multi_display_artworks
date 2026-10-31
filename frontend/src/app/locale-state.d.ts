export type Locale = "ko" | "en";
export const LOCALE_STORAGE_KEY: "metamuseum.locale";
export function getLocale(): Locale;
export function setLocale(value: Locale): void;
export function subscribeLocale(listener: () => void): () => void;
export function translate(
  ko: string,
  en: string,
  values?: Record<string, string | number>,
): string;
