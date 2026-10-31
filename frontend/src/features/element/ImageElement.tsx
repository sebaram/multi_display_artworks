import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { safeMediaUrl } from "../../api/media-url";
import type { ElementDTO } from "../../api/types";
import "./image-element.css";
import { useI18n, translate as t } from "../../app/i18n";
import { LanguageSwitcher } from "../../app/LanguageSwitcher";
import { displayError } from "../../app/error-message";

export default function ImageElement({
  elementId,
}: {
  elementId: string | null;
}) {
  useI18n();
  const [image, setImage] = useState<{ src: string; name: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      if (!elementId) throw Error("image_required");
      const element = await api<ElementDTO>(
        `/api/v1/elements/image/${encodeURIComponent(elementId)}`,
        { signal: abort.signal },
      );
      const src = safeMediaUrl(element.image_url);
      if (!src) throw Error("invalid_image_url");
      if (!abort.signal.aborted) setImage({ src, name: element.name || "" });
    }
    void load().catch((reason) => {
      if (!abort.signal.aborted) setError((reason as Error).message);
    });
    return () => abort.abort();
  }, [elementId]);

  return (
    <main
      className="element-image-view"
      aria-label={t("이미지 작품", "Image artwork")}
    >
      <div className="element-language">
        <LanguageSwitcher />
      </div>
      {error ? (
        <p role="alert">{displayError(error)}</p>
      ) : image ? (
        <img
          src={image.src}
          alt={image.name || t("이미지 작품", "Image artwork")}
          onError={() => setError("image_load_failed")}
        />
      ) : (
        <p role="status">{t("이미지를 불러오는 중…", "Loading image…")}</p>
      )}
    </main>
  );
}
