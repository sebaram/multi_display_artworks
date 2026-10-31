import { useCallback, useSyncExternalStore } from "react";
import {
  getLocale,
  setLocale,
  subscribeLocale,
  translate,
  type Locale,
} from "./locale-state.js";
export {
  getLocale,
  setLocale,
  subscribeLocale,
  translate,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./locale-state.js";
export type LocalizedText = string | readonly [string, string];
export function renderMessage(message: LocalizedText): string {
  return typeof message === "string" ? message : translate(...message);
}

export function useI18n() {
  const current = useSyncExternalStore(
    subscribeLocale,
    getLocale,
    () => "ko" as Locale,
  );
  const t = useCallback(
    (ko: string, en: string, values?: Record<string, string | number>) =>
      translate(ko, en, values),
    [current],
  );
  return { locale: current, setLocale, t };
}
