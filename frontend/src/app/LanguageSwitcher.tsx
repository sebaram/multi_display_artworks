import { useI18n, type Locale } from "./i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <select
      className="language-switcher"
      aria-label="언어 / Language"
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
    >
      <option value="ko" lang="ko">
        한국어
      </option>
      <option value="en" lang="en">
        English
      </option>
    </select>
  );
}
