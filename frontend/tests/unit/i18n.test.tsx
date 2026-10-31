import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocale,
  LOCALE_STORAGE_KEY,
  setLocale,
  translate,
  useI18n,
} from "../../src/app/i18n";
import { LanguageSwitcher } from "../../src/app/LanguageSwitcher";
import { displayError } from "../../src/app/error-message";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    clear: () => data.clear(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLocale("ko");
  vi.unstubAllGlobals();
});

describe("service language", () => {
  it("renders known API errors in the selected language without changing provider diagnostics", () => {
    expect(displayError("invalid_credentials")).toBe(
      "이메일과 비밀번호를 확인하세요.",
    );
    setLocale("en");
    expect(displayError("invalid_credentials")).toBe(
      "Check your email and password.",
    );
    expect(displayError("작품 이미지를 불러오지 못했습니다.")).toBe(
      "Unable to load the artwork image.",
    );
    expect(displayError("provider-specific diagnostic")).toBe(
      "provider-specific diagnostic",
    );
  });
  it("defaults to Korean and interpolates values without changing content", () => {
    expect(getLocale()).toBe("ko");
    expect(
      translate("{name} 입장", "Enter {name}", { name: "My 한국어 gallery" }),
    ).toBe("My 한국어 gallery 입장");
    setLocale("en");
    expect(
      translate("{name} 입장", "Enter {name}", { name: "My 한국어 gallery" }),
    ).toBe("Enter My 한국어 gallery");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Meta Museum · Exhibitions and encounters");
  });

  it("switches existing components without losing an edited value", () => {
    function Form() {
      const { t } = useI18n();
      return (
        <>
          <LanguageSwitcher />
          <label>
            {t("이름", "Name")}
            <input defaultValue="Original" />
          </label>
        </>
      );
    }
    render(<Form />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Unsaved 한국어 draft" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "언어 / Language" }),
      { target: { value: "en" } },
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Unsaved 한국어 draft",
    );
    expect(document.documentElement.lang).toBe("en");
  });

  it("continues switching when storage is blocked", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => setLocale("en")).not.toThrow();
    expect(getLocale()).toBe("en");
  });

  it("ignores invalid choices and responds to a valid change from another tab", () => {
    function Label() {
      const { t } = useI18n();
      return <span>{t("전시", "Exhibitions")}</span>;
    }
    render(<Label />);
    act(() => setLocale("fr" as "en"));
    expect(screen.getByText("전시")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LOCALE_STORAGE_KEY,
          newValue: "en",
        }),
      ),
    );
    expect(screen.getByText("Exhibitions")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LOCALE_STORAGE_KEY,
          newValue: "invalid",
        }),
      ),
    );
    expect(screen.getByText("전시")).toBeInTheDocument();
  });
});
