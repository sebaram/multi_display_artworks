import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { safeMediaUrl } from "../../api/media-url";
import type { ElementDTO } from "../../api/types";
import "./image-element.css";

export default function ImageElement({
  elementId,
}: {
  elementId: string | null;
}) {
  const [image, setImage] = useState<{ src: string; name: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      if (!elementId) throw Error("작품을 선택하세요.");
      const element = await api<ElementDTO>(
        `/api/v1/elements/image/${encodeURIComponent(elementId)}`,
        { signal: abort.signal },
      );
      const src = safeMediaUrl(element.image_url);
      if (!src) throw Error("이미지 주소가 올바르지 않습니다.");
      if (!abort.signal.aborted)
        setImage({ src, name: element.name || "이미지 작품" });
    }
    void load().catch((reason) => {
      if (!abort.signal.aborted) setError((reason as Error).message);
    });
    return () => abort.abort();
  }, [elementId]);

  return (
    <main className="element-image-view" aria-label="이미지 작품">
      {error ? (
        <p role="alert">{error}</p>
      ) : image ? (
        <img
          src={image.src}
          alt={image.name}
          onError={() => setError("이미지를 불러오지 못했습니다.")}
        />
      ) : (
        <p role="status">이미지를 불러오는 중…</p>
      )}
    </main>
  );
}
