import { useI18n } from "../../app/i18n";
import { displayError } from "../../app/error-message";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedChanges } from "../../app/navigation";
import { api, write, ApiError } from "../../api/client";
import type { RoomSummary } from "../../api/types";
import {
  createWallRenderer,
  normalizeWallLook,
  patchElement,
  addElement,
  removeElement,
  copyElement,
  pasteElement,
  objectTypes,
  appearanceFor,
  patchAppearance,
  addLayer,
  patchLayer,
  removeLayer,
  duplicateVideo,
  sanitizeTextHtml,
} from "../../wall-engine/index.js";
import {
  assignVideoSource,
  assignVideoScreens,
} from "../../wall-engine/reference/video-layers.js";
import { parseYoutube } from "../../wall-engine/reference/youtube-source.js";
import type {
  WallLookV1,
  WallElement,
  SourceState,
  WallRenderer,
  ElementTransform,
  VideoLayer,
} from "../../wall-engine/types";
import { createHistory, moveSelection, reorderCustom } from "./draft";
import { YouTubePreview } from "./YouTubePreview";
import "./wall-editor.css";

type Preset = {
  id: string;
  name: string;
  revision: number;
  read_only: boolean;
  source_key: string | null;
  config: WallLookV1;
  thumbnail_url: string | null;
};
type Binding = {
  revision: number;
  config: WallLookV1;
  preset_id: string | null;
};
type WallDetail = {
  id: string;
  width: number;
  height: number;
  room: string | { id: string };
};
type Manifest = {
  presets: { source_key: string; name: string; file: string }[];
};
const blank = () => normalizeWallLook();
const encoded = (id: string) => encodeURIComponent(id);
const objectLabels: Record<string, string> = {
  logo: "MV 조형물",
  ribbons: "현실 / 가상 리본",
  orbits: "궤도 조형물",
  network: "연구 네트워크",
  sphere: "구 조형물",
  arch: "건축 아치",
  presence: "공존 · 얽힌 리본",
  registration: "공유 좌표 · 움직이는 포털",
  feedback: "상호 반응 · 파동 교환",
  cocreation: "공동 창작 · 펼쳐지는 파빌리온",
  text: "텍스트 요소",
};
type UiMessage = [string, string];
class UiError extends Error {
  constructor(readonly text: UiMessage) {
    super(text[1]);
  }
}
const errorText = (e: unknown): UiMessage =>
  e instanceof UiError
    ? e.text
    : e instanceof ApiError && e.status === 409
      ? [
          "다른 곳에서 변경되었습니다 (409). 현재 초안은 유지됩니다. 최신 내용을 확인한 후 다시 시도하세요.",
          "Changed elsewhere (409). Your draft is preserved. Check the latest version and try again.",
        ]
      : e instanceof SyntaxError
        ? [
            "올바른 JSON 파일인지 확인하세요.",
            "Check that the JSON file is valid.",
          ]
        : [
            e instanceof Error ? e.message : String(e),
            e instanceof Error ? e.message : String(e),
          ];
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export default function WallEditor({
  wallId: initialWallId,
}: {
  wallId?: string;
}) {
  const { t } = useI18n();
  const [rooms, setRooms] = useState<RoomSummary[]>([]),
    [roomId, setRoomId] = useState(""),
    [wallId, setWallId] = useState(initialWallId || ""),
    [wall, setWall] = useState<WallDetail | null>(null);
  const [loadedWallId, setLoadedWallId] = useState("");
  const [wallLoadFailed, setWallLoadFailed] = useState(false);
  const [wallLoadAttempt, setWallLoadAttempt] = useState(0);
  const wallGeneration = useRef(0);
  const targetWall = useRef(initialWallId || "");
  const [presets, setPresets] = useState<Preset[]>([]),
    [source, setSource] = useState<Manifest["presets"]>([]),
    [preset, setPreset] = useState<Preset | null>(null),
    [binding, setBinding] = useState<Binding | null>(null);
  const [look, setLook] = useState<WallLookV1>(blank),
    [saved, setSaved] = useState(JSON.stringify(blank())),
    [name, setName] = useState(t("새 프리셋", "New preset")),
    [savedName, setSavedName] = useState(t("새 프리셋", "New preset"));
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState(true);
  const [wallWritePending, setWallWritePending] = useState(false);
  const mutedRef = useRef(true);
  const [selection, setSelection] = useState<string[]>([]),
    [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
      null,
    );
  const [elements, setElements] = useState<WallElement[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [presetQuery, setPresetQuery] = useState(""),
    [error, setError] = useState<UiMessage | null>(null),
    [notice, setNotice] = useState<UiMessage | null>(null),
    [busy, setBusy] = useState(false),
    [youtube, setYoutube] = useState(""),
    [openYoutube, setOpenYoutube] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<WallRenderer | null>(null),
    history = useRef(createHistory(blank())),
    clipboard = useRef<unknown>(null),
    drag = useRef<{
      x: number;
      y: number;
      originX: number;
      originY: number;
      id: string;
      state: SourceState;
      elements: WallElement[];
      ids: string[];
    } | null>(null),
    lookRef = useRef(look),
    selectedRef = useRef(selected),
    epoch = useRef(performance.now());
  lookRef.current = look;
  selectedRef.current = selected;
  const wallReady = !!wallId && loadedWallId === wallId;
  const wallLoading = !!wallId && !wallReady;
  const dirty = JSON.stringify(look) !== saved || name !== savedName;
  useUnsavedChanges(dirty);
  const guard = useCallback(
    () =>
      !dirty ||
      window.confirm(
        t("저장하지 않은 초안을 버리시겠습니까?", "Discard the unsaved draft?"),
      ),
    [dirty, t],
  );
  const install = useCallback((next: WallLookV1, clean = true) => {
    const normalized = normalizeWallLook(next);
    history.current = createHistory(normalized);
    setLook(normalized);
    setSelected(null);
    setSelection([]);
    if (clean) setSaved(JSON.stringify(normalized));
  }, []);
  const change = useCallback((fn: (l: WallLookV1) => WallLookV1) => {
    setLook((prev) => {
      const next = fn(prev);
      history.current.record(next);
      return next;
    });
  }, []);
  const changeState = useCallback(
    (fn: (s: SourceState) => SourceState) =>
      change((l) => ({ ...l, state: fn(l.state) })),
    [change],
  );
  const loadPresets = useCallback(async () => {
    try {
      setPresets(await api<Preset[]>("/api/v1/wall-presets"));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    api<RoomSummary[]>("/api/v1/rooms")
      .then(setRooms)
      .catch((e) => setError(errorText(e)));
    loadPresets();
    fetch("/wall-presets/manifest.json")
      .then((r) => {
        if (!r.ok)
          throw new UiError([
            "원본 프리셋 목록을 불러오지 못했습니다.",
            "Could not load the source preset list.",
          ]);
        return r.json();
      })
      .then((m: Manifest) => setSource(m.presets))
      .catch((e) => setError(errorText(e)));
  }, [loadPresets]);
  useEffect(() => {
    if (!source.length) return;
    let cancelled = false;
    let r: WallRenderer | undefined;
    const build = async () => {
      try {
        const c = document.createElement("canvas");
        c.width = 240;
        c.height = 135;
        r = createWallRenderer({ canvas: c, config: blank() });
        r.resize(240, 135);
        for (const item of source) {
          if (cancelled) break;
          try {
            const response = await fetch(`/wall-presets/${item.file}`);
            if (!response.ok) continue;
            const data = await response.json();
            r.setConfig(data.config);
            r.render(0);
            const image = c.toDataURL("image/png");
            if (!cancelled)
              setThumbnails((previous) => ({
                ...previous,
                [item.source_key]: image,
              }));
          } catch {
            /* Failed previews leave the source title selectable. */
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch {
        /* The main renderer reports WebGL errors. */
      } finally {
        r?.dispose();
      }
    };
    void build();
    return () => {
      cancelled = true;
    };
  }, [source]);
  useEffect(() => {
    const generation = ++wallGeneration.current;
    targetWall.current = wallId;
    setLoadedWallId("");
    setWallLoadFailed(false);
    setWall(null);
    setBinding(null);
    if (!wallId) return;
    let active = true;
    Promise.all([
      api<WallDetail>(`/api/v1/walls/${encoded(wallId)}`),
      api<Binding | null>(`/api/v1/walls/${encoded(wallId)}/design`),
    ])
      .then(([w, b]) => {
        if (
          !active ||
          wallGeneration.current !== generation ||
          targetWall.current !== wallId
        )
          return;
        setWall(w);
        setRoomId(typeof w.room === "string" ? w.room : w.room.id);
        setBinding(b);
        if (b) {
          install(b.config);
          setName(t("적용된 디자인", "Applied design"));
          setSavedName(t("적용된 디자인", "Applied design"));
          setPreset(null);
        }
        setLoadedWallId(wallId);
      })
      .catch((e) => {
        if (
          active &&
          wallGeneration.current === generation &&
          targetWall.current === wallId
        ) {
          setWallLoadFailed(true);
          setError(errorText(e));
        }
      });
    return () => {
      active = false;
    };
  }, [wallId, install, wallLoadAttempt]);
  useEffect(() => {
    if (!canvas.current) return;
    let frame = 0,
      disposed = false;
    try {
      const r = createWallRenderer({
        canvas: canvas.current,
        config: lookRef.current,
        assetResolver: (id) => `/api/v1/wall-assets/${encoded(id)}/content`,
        onError: (e) => setError(errorText(`${e.code}: ${e.message}`)),
      });
      renderer.current = r;
      r.setMuted(mutedRef.current);
      const resize = () => {
        if (!canvas.current) return;
        const width = Math.max(1, Math.round(canvas.current.clientWidth));
        const aspect =
          wall?.width && wall?.height ? wall.width / wall.height : 16 / 9;
        r.resize(width, Math.max(1, Math.round(width / aspect)));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas.current);
      resize();
      const tick = () => {
        if (disposed) return;
        const l = lookRef.current;
        const t =
          l.state.offset +
          (l.state.paused
            ? 0
            : ((performance.now() - epoch.current) / 1000) * l.state.speed);
        r.render(t, {
          positionSeconds: t,
          playing: !l.state.paused,
          rate: l.state.speed,
        });
        frame = requestAnimationFrame(tick);
      };
      tick();
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        r.dispose();
        renderer.current = null;
      };
    } catch (e) {
      setError(errorText(e));
    }
  }, [wall?.width, wall?.height]);
  useEffect(() => {
    if (!renderer.current) return;
    try {
      renderer.current.setConfig(look);
      setElements(renderer.current.getElements());
    } catch (e) {
      setError(errorText(e));
    }
  }, [look]);
  const choose = (id: string, extend = false) => {
    setSelected(id);
    setSelection((previous) =>
      extend ? [...new Set([...previous, id])] : [id],
    );
  };
  const setGrouping = (ungrouped: boolean) => {
    changeState((s) =>
      selection.reduce(
        (next, id) =>
          id.startsWith("media:")
            ? next
            : patchElement(next, id, { ungrouped }),
        s,
      ),
    );
  };
  const reorder = (id: string, delta: number) =>
    changeState((s) => reorderCustom(s, id, delta));
  const selectedElement = elements.find((e) => e.id === selected),
    video = selected?.startsWith("media:")
      ? look.state.videoLayers.find((v) => v.id === selected.slice(6))
      : undefined;
  const patch = (p: ElementTransform) => {
    if (selected) changeState((s) => patchElement(s, selected, p));
  };
  const patchVideo = (p: Partial<VideoLayer>) => {
    if (video) changeState((s) => patchLayer(s, video.id, p));
  };
  const doUndo = (redo = false) => {
    setLook(redo ? history.current.redo() : history.current.undo());
  };
  const copy = () => {
    if (video) {
      clipboard.current = { video: structuredClone(video) };
    } else if (selectedElement)
      clipboard.current = copyElement(look.state, selectedElement);
  };
  const paste = () => {
    if (!clipboard.current) return;
    const c = clipboard.current as { video?: VideoLayer };
    changeState((s) =>
      c.video ? duplicateVideo(s, c.video) : pasteElement(s, c),
    );
  };
  const remove = () => {
    if (!selected) return;
    changeState((s) =>
      video ? removeLayer(s, video.id) : removeElement(s, selected),
    );
    setSelected(null);
    setSelection([]);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (wallLoading || busy) return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doUndo(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doUndo(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        copy();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) {
          e.preventDefault();
          remove();
        }
        return;
      }
      if (
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const delta = e.shiftKey ? 1 : 0.1;
        const dx =
            e.key === "ArrowLeft" ? -delta : e.key === "ArrowRight" ? delta : 0,
          dy = e.key === "ArrowUp" ? -delta : e.key === "ArrowDown" ? delta : 0;
        changeState((s) =>
          moveSelection(
            s,
            elements,
            selection.length ? selection : [selected],
            dx,
            dy,
          ),
        );
      }
    };
    const root = document.getElementById("wall-editor");
    root?.addEventListener("keydown", key);
    return () => root?.removeEventListener("keydown", key);
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const selectPreset = (p: Preset) => {
    if (!guard()) return;
    install(p.config);
    setPreset(p);
    setName(p.name);
    setSavedName(p.name);
  };
  const selectSource = (s: Manifest["presets"][number]) => {
    if (!guard()) return;
    void run(async () => {
      const r = await fetch(`/wall-presets/${s.file}`);
      if (!r.ok)
        throw new UiError([
          "원본 프리셋을 불러오지 못했습니다.",
          "Could not load the source preset.",
        ]);
      const p = await r.json();
      install(p.config);
      setName(s.name);
      setSavedName(s.name);
      setPreset(null);
    });
  };
  const save = (copyNew = false) =>
    run(async () => {
      const payload = { name, config: look };
      const result =
        !copyNew && preset && !preset.read_only
          ? ((await write(
              `/api/v1/wall-presets/${encoded(preset.id)}`,
              "PATCH",
              { ...payload, expected_revision: preset.revision },
            )) as Preset)
          : ((await write("/api/v1/wall-presets", "POST", payload)) as Preset);
      setPreset(result);
      setSaved(JSON.stringify(look));
      setSavedName(name);
      await loadPresets();
      setNotice([
        "프리셋을 저장했습니다. 월에는 아직 적용되지 않았습니다.",
        "Preset saved. It has not been applied to the wall yet.",
      ]);
    });
  const apply = () => {
    if (!wallReady || targetWall.current !== wallId) return;
    const target = wallId,
      generation = wallGeneration.current;
    setWallWritePending(true);
    void run(async () => {
      try {
        const result = (await write(
          `/api/v1/walls/${encoded(target)}/design`,
          "PUT",
          { config: look, expected_revision: binding?.revision ?? 0 },
        )) as Binding;
        if (
          targetWall.current !== target ||
          wallGeneration.current !== generation
        )
          return;
        setBinding(result);
        setNotice([
          "현재 초안을 월에 적용했습니다.",
          "Applied the current draft to the wall.",
        ]);
      } catch (e) {
        if (
          targetWall.current === target &&
          wallGeneration.current === generation
        )
          throw e;
      }
    }).finally(() => setWallWritePending(false));
  };
  const resetBinding = () => {
    if (!wallReady || !binding || targetWall.current !== wallId) return;
    if (
      !window.confirm(
        t(
          "적용된 디자인을 제거하고 기존 배경으로 되돌리시겠습니까?",
          "Remove the applied design and restore the previous background?",
        ),
      )
    )
      return;
    const target = wallId,
      generation = wallGeneration.current,
      revision = binding.revision;
    setWallWritePending(true);
    void run(async () => {
      try {
        await write(
          `/api/v1/walls/${encoded(target)}/design?expected_revision=${revision}`,
          "DELETE",
        );
        if (
          targetWall.current !== target ||
          wallGeneration.current !== generation
        )
          return;
        setBinding(null);
        setNotice([
          "기존 배경으로 되돌렸습니다.",
          "Restored the previous background.",
        ]);
      } catch (e) {
        if (
          targetWall.current === target &&
          wallGeneration.current === generation
        )
          throw e;
      }
    }).finally(() => setWallWritePending(false));
  };
  const upload = async (file: File) => {
    if (!video) return;
    await run(async () => {
      const form = new FormData();
      form.append("file", file);
      const asset = await api<{ id: string; name: string }>(
        "/api/v1/wall-assets",
        { method: "POST", body: form },
      );
      changeState((s) =>
        assignVideoSource(s, video.id, {
          assetId: asset.id,
          fileName: asset.name,
        }),
      );
    });
  };
  const importFile = async (file: File) => {
    if (!guard()) return;
    await run(async () => {
      const parsed = JSON.parse(await file.text());
      const config = normalizeWallLook(parsed.config ?? parsed);
      const result = (await write("/api/v1/wall-presets/import", "POST", {
        name: parsed.name || file.name.replace(/\.json$/i, ""),
        config,
      })) as Preset;
      install(result.config);
      setName(result.name);
      setSavedName(result.name);
      setPreset(result);
      await loadPresets();
    });
  };
  const thumb = () =>
    run(async () => {
      if (!preset || preset.read_only)
        throw new UiError([
          "썸네일을 연결하려면 먼저 사용자 프리셋을 저장하세요.",
          "Save a custom preset before attaching a thumbnail.",
        ]);
      if (!canvas.current)
        throw new UiError([
          "미리보기를 사용할 수 없습니다.",
          "Preview is unavailable.",
        ]);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.current!.toBlob(resolve, "image/png"),
      );
      if (!blob)
        throw new UiError([
          "썸네일 생성에 실패했습니다.",
          "Could not create a thumbnail.",
        ]);
      const form = new FormData();
      form.append("file", blob, "thumbnail.png");
      const asset = await api<{ id: string }>("/api/v1/wall-assets", {
        method: "POST",
        body: form,
      });
      const result = (await write(
        `/api/v1/wall-presets/${encoded(preset.id)}`,
        "PATCH",
        { thumbnail_asset_id: asset.id, expected_revision: preset.revision },
      )) as Preset;
      setPreset(result);
      await loadPresets();
      setNotice(["썸네일을 저장했습니다.", "Thumbnail saved."]);
    });
  const layerList = useMemo(
    () =>
      elements.filter(
        (e) =>
          e.name.toLowerCase().includes(query.toLowerCase()) ||
          e.id.toLowerCase().includes(query.toLowerCase()),
      ),
    [elements, query],
  );
  const changeWall = (id: string) => {
    if (!guard()) return;
    wallGeneration.current++;
    drag.current = null;
    targetWall.current = id;
    setLoadedWallId("");
    setWall(null);
    setBinding(null);
    setWallId(id);
  };
  const num = (
    label: string,
    value: number | undefined,
    onChange: (v: number) => void,
    step = 1,
    key?: string,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        step={step}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
  return (
    <main id="wall-editor" className="wall-studio" tabIndex={-1}>
      <header>
        <div>
          <h1>{t("월 디자인 스튜디오", "Wall design studio")}</h1>
          <p>
            {t(
              "작품 배치와 월 크기는 변경하지 않습니다.",
              "Artwork placement and wall dimensions stay unchanged.",
            )}
          </p>
        </div>
        <div className="wall-actions">
          <button
            onClick={() => doUndo()}
            disabled={busy || wallLoading || !history.current.canUndo}
          >
            {t("실행 취소", "Undo")}
          </button>
          <button
            onClick={() => doUndo(true)}
            disabled={busy || wallLoading || !history.current.canRedo}
          >
            {t("다시 실행", "Redo")}
          </button>
          <button
            disabled={busy || wallLoading || !dirty}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    "초안을 마지막 저장 상태로 되돌리시겠습니까?",
                    "Restore the draft to its last saved state?",
                  ),
                )
              ) {
                install(JSON.parse(saved));
                setName(savedName);
              }
            }}
          >
            {t("초안 되돌리기", "Revert draft")}
          </button>
          <button disabled={busy || wallLoading} onClick={() => save()}>
            {t("저장", "Save")}
          </button>
          <button disabled={busy || wallLoading} onClick={() => save(true)}>
            {t("복제 저장", "Save a copy")}
          </button>
          <button disabled={busy || !wallReady} onClick={apply}>
            {t("월에 적용", "Apply to wall")}
          </button>
          <button
            disabled={!wallReady || !binding || busy}
            onClick={resetBinding}
          >
            {t("적용 제거", "Remove design")}
          </button>
        </div>
      </header>
      <div className="wall-context">
        <label>
          {t("방", "Room")}
          <select
            disabled={busy && !wallWritePending}
            value={roomId}
            onChange={(e) => {
              if (!guard()) return;
              wallGeneration.current++;
              drag.current = null;
              targetWall.current = "";
              setLoadedWallId("");
              setWall(null);
              setBinding(null);
              setRoomId(e.target.value);
              setWallId("");
            }}
          >
            <option value="">{t("방 선택", "Select a room")}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("월", "Wall")}
          <select
            disabled={busy && !wallWritePending}
            value={wallId}
            onChange={(e) => changeWall(e.target.value)}
          >
            <option value="">{t("월 선택", "Select a wall")}</option>
            {(rooms.find((r) => r.id === roomId)?.walls || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name || w.id}
              </option>
            ))}
          </select>
        </label>
        <span>
          {dirty
            ? t("● 저장되지 않은 초안", "● Unsaved draft")
            : t("저장된 상태", "Saved")}{" "}
          ·{" "}
          {wallLoadFailed
            ? t("월 정보를 불러오지 못했습니다", "Could not load the wall")
            : wallLoading
              ? t("월 정보 불러오는 중…", "Loading wall…")
              : binding
                ? t("적용 버전 {revision}", "Applied revision {revision}", {
                    revision: binding.revision,
                  })
                : t("적용된 디자인 없음", "No applied design")}
        </span>
      </div>
      {wallLoadFailed && (
        <button onClick={() => setWallLoadAttempt((n) => n + 1)}>
          {t("월 정보 다시 불러오기", "Reload wall")}
        </button>
      )}
      {error && (
        <p role="alert" className="wall-error">
          {displayError(t(...error))}
        </p>
      )}
      {notice && <p role="status">{t(...notice)}</p>}
      <fieldset className="wall-grid" disabled={wallLoading || busy}>
        <aside>
          <section>
            <h2>{t("프리셋", "Presets")}</h2>
            <input
              aria-label={t("프리셋 검색", "Search presets")}
              placeholder={t("프리셋 검색", "Search presets")}
              value={presetQuery}
              onChange={(e) => setPresetQuery(e.target.value)}
            />
            <div className="preset-grid">
              {presets
                .filter((p) =>
                  p.name.toLowerCase().includes(presetQuery.toLowerCase()),
                )
                .map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p)}>
                    {(p.thumbnail_url ||
                      (p.source_key && thumbnails[p.source_key])) && (
                      <img
                        src={p.thumbnail_url || thumbnails[p.source_key!]}
                        alt=""
                      />
                    )}
                    <span>{p.name}</span>
                    <small>
                      {p.read_only
                        ? t("원본", "Source")
                        : t("사용자", "Custom")}
                    </small>
                  </button>
                ))}
              {source
                .filter(
                  (s) =>
                    !presets.some((p) => p.source_key === s.source_key) &&
                    s.name.toLowerCase().includes(presetQuery.toLowerCase()),
                )
                .map((s) => (
                  <button key={s.source_key} onClick={() => selectSource(s)}>
                    {thumbnails[s.source_key] && (
                      <img src={thumbnails[s.source_key]} alt="" />
                    )}
                    <span>{s.name}</span>
                    <small>{t("원본", "Source")}</small>
                  </button>
                ))}
            </div>
            <label>
              {t("이름", "Name")}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="wall-actions">
              <button onClick={thumb} disabled={busy}>
                {t("썸네일 생성", "Create thumbnail")}
              </button>
              <button
                onClick={() =>
                  download(
                    `${name || "wall"}.json`,
                    JSON.stringify({ name, config: look }, null, 2),
                  )
                }
              >
                {t("JSON 내보내기", "Export JSON")}
              </button>
              <label className="button">
                {t("JSON 가져오기", "Import JSON")}
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                disabled={!preset || preset.read_only || busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      !preset ||
                      !window.confirm(
                        t("프리셋을 삭제하시겠습니까?", "Delete this preset?"),
                      )
                    )
                      return;
                    await write(
                      `/api/v1/wall-presets/${encoded(preset.id)}?expected_revision=${preset.revision}`,
                      "DELETE",
                    );
                    setPreset(null);
                    await loadPresets();
                    setNotice([
                      "프리셋을 삭제했습니다. 적용된 월은 유지됩니다.",
                      "Preset deleted. Applied walls are preserved.",
                    ]);
                  })
                }
              >
                {t("삭제", "Delete")}
              </button>
            </div>
          </section>
          <section>
            <h2>{t("레이어", "Layers")}</h2>
            <input
              aria-label={t("레이어 검색", "Search layers")}
              placeholder={t("레이어 검색", "Search layers")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="layer-list">
              {layerList.map((e) => (
                <button
                  key={e.id}
                  className={selection.includes(e.id) ? "active" : ""}
                  style={{ paddingLeft: `${8 + e.depth * 14}px` }}
                  onClick={(event) =>
                    choose(
                      e.id,
                      event.ctrlKey || event.metaKey || event.shiftKey,
                    )
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    choose(e.id);
                    setMenu({
                      id: e.id,
                      x: Math.max(
                        0,
                        Math.min(event.clientX, window.innerWidth - 200),
                      ),
                      y: Math.max(
                        0,
                        Math.min(event.clientY, window.innerHeight - 330),
                      ),
                    });
                  }}
                  title={e.id}
                >
                  {e.visible === false ? "◌" : "●"} {e.name}
                </button>
              ))}
            </div>
            <p>
              {t(
                "Ctrl/Shift를 누르고 여러 레이어를 선택하세요. 그룹 해제와 복원은 원본 계층에 적용됩니다.",
                "Hold Ctrl/Shift to select multiple layers. Ungroup and restore apply to the source hierarchy.",
              )}
            </p>
            <div className="wall-actions">
              <button
                disabled={!selection.length}
                onClick={() => setGrouping(true)}
              >
                {t("그룹 해제", "Ungroup")}
              </button>
              <button
                disabled={!selection.length}
                onClick={() => setGrouping(false)}
              >
                {t("그룹 복원", "Restore group")}
              </button>
              <button
                disabled={
                  !selectedElement?.custom ||
                  !!selectedElement.parentId ||
                  !!video
                }
                onClick={() => selected && reorder(selected, -1)}
              >
                {t("사용자 오브젝트 위로", "Move custom object up")}
              </button>
              <button
                disabled={
                  !selectedElement?.custom ||
                  !!selectedElement.parentId ||
                  !!video
                }
                onClick={() => selected && reorder(selected, 1)}
              >
                {t("사용자 오브젝트 아래로", "Move custom object down")}
              </button>
            </div>
            {menu && (
              <div
                className="layer-menu"
                style={{ left: menu.x, top: menu.y }}
                role="menu"
              >
                <button
                  onClick={() => {
                    copy();
                    setMenu(null);
                  }}
                >
                  {t("복사", "Copy")}
                </button>
                <button
                  onClick={() => {
                    paste();
                    setMenu(null);
                  }}
                >
                  {t("붙여넣기", "Paste")}
                </button>
                <button
                  onClick={() => {
                    remove();
                    setMenu(null);
                  }}
                >
                  {t("삭제", "Delete")}
                </button>
                <button
                  onClick={() => {
                    if (video) patchVideo({ enabled: video.enabled === false });
                    else if (selectedElement)
                      patch({ visible: selectedElement.visible === false });
                    setMenu(null);
                  }}
                >
                  {t("표시 전환", "Toggle visibility")}
                </button>
                <button
                  onClick={() => {
                    copy();
                    setTimeout(paste, 0);
                    setMenu(null);
                  }}
                >
                  {t("복제", "Duplicate")}
                </button>
                <button
                  onClick={() => {
                    setGrouping(true);
                    setMenu(null);
                  }}
                >
                  {t("그룹 해제", "Ungroup")}
                </button>
                <button
                  onClick={() => {
                    setGrouping(false);
                    setMenu(null);
                  }}
                >
                  {t("그룹 복원", "Restore group")}
                </button>
                <button onClick={() => setMenu(null)}>
                  {t("닫기", "Close")}
                </button>
              </div>
            )}
            <label>
              {t("오브젝트 추가", "Add object")}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    const next = addElement(look.state, e.target.value);
                    change((l) => ({ ...l, state: next }));
                    setSelected(next.activeElement || null);
                    setSelection(
                      next.activeElement ? [next.activeElement] : [],
                    );
                    e.target.value = "";
                  }
                }}
              >
                <option value="">{t("선택…", "Select…")}</option>
                {objectTypes.map(([id, label]) => (
                  <option value={id} key={id}>
                    {t(objectLabels[id] || label, label)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={look.state.videoLayers.length >= 8}
              onClick={() => {
                const next = addLayer(look.state, { id: null });
                change((l) => ({ ...l, state: next }));
                setSelected(next.activeElement || null);
              }}
            >
              {t("영상 추가 ({count}/8)", "Add video ({count}/8)", {
                count: look.state.videoLayers.length,
              })}
            </button>
          </section>
        </aside>
        <section className="wall-stage">
          <div
            className="stage-frame"
            style={{
              aspectRatio:
                wall?.width && wall?.height
                  ? `${wall.width} / ${wall.height}`
                  : "16 / 9",
            }}
          >
            <canvas
              ref={canvas}
              aria-label={t("월 디자인 미리보기", "Wall design preview")}
              onPointerDown={(e) => {
                if (wallLoading || busy) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const hit = renderer.current?.pick(
                  (e.clientX - rect.left) / rect.width,
                  (e.clientY - rect.top) / rect.height,
                );
                if (!hit) {
                  setSelected(null);
                  setSelection([]);
                  return;
                }
                if (
                  !selection.includes(hit.id) ||
                  e.ctrlKey ||
                  e.metaKey ||
                  e.shiftKey
                )
                  choose(hit.id, e.ctrlKey || e.metaKey || e.shiftKey);
                else setSelected(hit.id);
                const item = elements.find((el) => el.id === hit.id);
                const v = look.state.videoLayers.find(
                  (l) => `media:${l.id}` === hit.id,
                );
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  originX: v?.x ?? item?.x ?? 50,
                  originY: v?.y ?? item?.y ?? 50,
                  id: hit.id,
                  state: look.state,
                  elements,
                  ids:
                    selection.includes(hit.id) && selection.length > 1
                      ? selection
                      : [hit.id],
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (wallLoading || busy) return;
                const d = drag.current;
                if (!d) return;
                const rect = e.currentTarget.getBoundingClientRect(),
                  x = d.originX + ((e.clientX - d.x) / rect.width) * 100,
                  y = d.originY + ((e.clientY - d.y) / rect.height) * 100;
                setLook((l) => ({
                  ...l,
                  state: moveSelection(
                    d.state,
                    d.elements,
                    d.ids,
                    x - d.originX,
                    y - d.originY,
                  ),
                }));
              }}
              onPointerUp={() => {
                if (drag.current) {
                  history.current.record(lookRef.current);
                  drag.current = null;
                }
              }}
              onPointerCancel={() => {
                if (drag.current) {
                  history.current.record(lookRef.current);
                  drag.current = null;
                }
              }}
            />
          </div>
          <p>
            {t(
              "캔버스에서 선택하고 드래그하거나 방향키로 이동하세요. Shift + 방향키는 더 크게 이동합니다.",
              "Select and drag on the canvas, or move with the arrow keys. Hold Shift for larger steps.",
            )}
          </p>
          <p>
            {t(
              "공유 영상 재생 제어는 실시간 연결이 준비되면 사용할 수 있습니다. YouTube는 별도 플레이어에서 열립니다.",
              "Shared video playback controls become available when the live connection is ready. YouTube opens in a separate player.",
            )}
          </p>
          {look.state.videoLayers.some((v) => v.assetId) && (
            <button
              onClick={() => {
                const next = !mutedRef.current;
                mutedRef.current = next;
                renderer.current?.setMuted(next);
                setMuted(next);
              }}
            >
              {muted
                ? t("이 기기 영상 소리 켜기", "Unmute video on this device")
                : t("이 기기 영상 소리 끄기", "Mute video on this device")}
            </button>
          )}
          {look.state.videoLayers
            .filter((v) => v.youtube)
            .map((v) =>
              openYoutube === v.id ? (
                <YouTubePreview
                  key={v.id}
                  id={v.id}
                  videoId={v.youtube!.id}
                  title={v.name || "YouTube"}
                  renderer={renderer}
                  onClose={() => setOpenYoutube(null)}
                />
              ) : (
                <button key={v.id} onClick={() => setOpenYoutube(v.id)}>
                  {t(
                    "{name} 별도 플레이어 열기",
                    "Open {name} in a separate player",
                    { name: v.name || "YouTube" },
                  )}
                </button>
              ),
            )}
        </section>
        <aside>
          <section>
            <h2>{t("선택 속성", "Selection properties")}</h2>
            {selectedElement || video ? (
              <>
                <div className="wall-actions">
                  <button onClick={copy}>{t("복사", "Copy")}</button>
                  <button onClick={paste}>{t("붙여넣기", "Paste")}</button>
                  <button
                    onClick={() => {
                      copy();
                      setTimeout(paste, 0);
                    }}
                  >
                    {t("복제", "Duplicate")}
                  </button>
                  <button onClick={remove}>{t("삭제", "Delete")}</button>
                </div>
                {video ? (
                  <>
                    <h3>{video.name || video.id}</h3>
                    <label>
                      {t("표시", "Visible")}
                      <input
                        type="checkbox"
                        checked={video.enabled !== false}
                        onChange={(e) =>
                          patchVideo({ enabled: e.target.checked })
                        }
                      />
                    </label>
                    {num("X (%)", video.x, (v) => patchVideo({ x: v }), 0.1)}
                    {num("Y (%)", video.y, (v) => patchVideo({ y: v }), 0.1)}
                    {num(
                      t("너비 (%)", "Width (%)"),
                      video.width,
                      (v) => patchVideo({ width: v }),
                      0.1,
                    )}
                    {num(
                      t("재생 속도", "Playback speed"),
                      video.motionSpeed ?? 1,
                      (v) => patchVideo({ motionSpeed: v }),
                      0.1,
                    )}
                    {num(
                      t("영상 모션 기준", "Video motion anchor"),
                      video.motionAnchor ?? 0,
                      (v) => patchVideo({ motionAnchor: v }),
                      0.1,
                    )}
                    {num(
                      t("영상 모션 오프셋", "Video motion offset"),
                      video.motionOffset ?? 0,
                      (v) => patchVideo({ motionOffset: v }),
                      0.1,
                    )}
                    <fieldset>
                      <legend>{t("표시 화면", "Target screens")}</legend>
                      {look.state.screens.map((screen) => (
                        <label key={screen.id}>
                          <input
                            type="checkbox"
                            checked={
                              !video.targets ||
                              video.targets.includes(screen.id)
                            }
                            onChange={(e) => {
                              const ids = look.state.screens
                                .filter(
                                  (sc) =>
                                    !video.targets ||
                                    video.targets.includes(sc.id),
                                )
                                .map((sc) => sc.id);
                              const next = e.target.checked
                                ? [...new Set([...ids, screen.id])]
                                : ids.filter((id) => id !== screen.id);
                              changeState((s) =>
                                assignVideoScreens(s, video.id, next),
                              );
                            }}
                          />
                          {screen.name || screen.id}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      {t("영상 업로드", "Upload video")}
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void upload(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <label>
                      {t("YouTube URL 또는 ID", "YouTube URL or ID")}
                      <input
                        value={youtube}
                        onChange={(e) => setYoutube(e.target.value)}
                      />
                    </label>
                    <button
                      onClick={() => {
                        const parsed = parseYoutube(youtube);
                        if (!parsed) {
                          setError([
                            "올바른 YouTube 주소를 입력하세요.",
                            "Enter a valid YouTube URL.",
                          ]);
                          return;
                        }
                        changeState((s) =>
                          assignVideoSource(s, video.id, {
                            youtube: parsed as NonNullable<
                              VideoLayer["youtube"]
                            >,
                            sourceAspect: parsed.sourceAspect,
                          }),
                        );
                        setYoutube("");
                      }}
                    >
                      {t("YouTube 선택", "Select YouTube")}
                    </button>
                    <p>
                      {t("현재 소스:", "Current source:")}{" "}
                      {video.youtube
                        ? "YouTube"
                        : video.fileName ||
                          video.assetId ||
                          t("선택 안 됨", "None selected")}
                    </p>
                  </>
                ) : (
                  selectedElement && (
                    <>
                      <h3>{selectedElement.name}</h3>
                      <label>
                        {t("표시", "Visible")}
                        <input
                          type="checkbox"
                          checked={selectedElement.visible !== false}
                          onChange={(e) => patch({ visible: e.target.checked })}
                        />
                      </label>
                      {num(
                        "X (%)",
                        selectedElement.x,
                        (v) => patch({ x: v }),
                        0.1,
                      )}
                      {num(
                        "Y (%)",
                        selectedElement.y,
                        (v) => patch({ y: v }),
                        0.1,
                      )}
                      {num(
                        t("크기", "Size"),
                        selectedElement.size ?? 1,
                        (v) => patch({ size: v }),
                        0.05,
                      )}
                      {num(
                        t("회전 (°)", "Rotation (°)"),
                        selectedElement.rotation,
                        (v) => patch({ rotation: v }),
                        1,
                      )}
                      <label>
                        {t("그룹 해제", "Ungroup")}
                        <input
                          type="checkbox"
                          checked={!!selectedElement.ungrouped}
                          onChange={(e) =>
                            patch({ ungrouped: e.target.checked })
                          }
                        />
                      </label>
                      {num(t("시드", "Seed"), selectedElement.seed, (v) =>
                        patch({ seed: v }),
                      )}
                      {num(
                        t("무작위성", "Randomness"),
                        selectedElement.randomness,
                        (v) => patch({ randomness: v }),
                        0.1,
                      )}
                      {num(
                        t("모션 속도", "Motion speed"),
                        selectedElement.motionSpeed ?? 1,
                        (v) => patch({ motionSpeed: v }),
                        0.1,
                      )}
                      {num(
                        t("모션 크기", "Motion amount"),
                        selectedElement.motionAmount ?? 1,
                        (v) => patch({ motionAmount: v }),
                        0.1,
                      )}
                      {num(
                        t("모션 기준", "Motion anchor"),
                        selectedElement.motionAnchor ?? 0,
                        (v) => patch({ motionAnchor: v }),
                        0.1,
                      )}
                      {num(
                        t("모션 오프셋", "Motion offset"),
                        selectedElement.motionOffset ?? 0,
                        (v) => patch({ motionOffset: v }),
                        0.1,
                      )}
                      <label>
                        {t("오브젝트 화면", "Object screen")}
                        <select
                          value={selectedElement.screen || look.logical_screen}
                          onChange={(e) => patch({ screen: e.target.value })}
                        >
                          {look.state.screens.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedElement.text && (
                        <>
                          <p>{t("텍스트 서식", "Text formatting")}</p>
                          <div className="wall-actions">
                            {[
                              [t("굵게", "Bold"), "strong"],
                              [t("기울임", "Italic"), "em"],
                              [t("밑줄", "Underline"), "u"],
                              [t("취소선", "Strikethrough"), "s"],
                            ].map(([label, tag]) => (
                              <button
                                key={tag}
                                onClick={() =>
                                  patch({
                                    textHtml: sanitizeTextHtml(
                                      `<${tag}>${selectedElement.textHtml || ""}</${tag}>`,
                                    ),
                                  })
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <label>
                            {t("텍스트 (서식 HTML)", "Text (formatted HTML)")}
                            <textarea
                              value={selectedElement.textHtml || ""}
                              onChange={(e) =>
                                patch({
                                  textHtml: sanitizeTextHtml(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            {t("글꼴", "Font")}
                            <select
                              value={selectedElement.textFont || "sans"}
                              onChange={(e) =>
                                patch({
                                  textFont: e.target
                                    .value as ElementTransform["textFont"],
                                })
                              }
                            >
                              {[
                                ["sans", t("산세리프", "Sans serif")],
                                ["host", t("기본 글꼴", "Default font")],
                                ["arial", "Arial"],
                                ["serif", t("세리프", "Serif")],
                                ["mono", t("고정폭", "Monospace")],
                                ["malgun", t("맑은 고딕", "Malgun Gothic")],
                              ].map(([font, label]) => (
                                <option key={font} value={font}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {num(
                            t("글자 크기", "Font size"),
                            selectedElement.textSize,
                            (v) => patch({ textSize: v }),
                          )}
                          <label>
                            {t("색상", "Color")}
                            <input
                              type="color"
                              value={selectedElement.textColor || "#ffffff"}
                              onChange={(e) =>
                                patch({ textColor: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t("정렬", "Alignment")}
                            <select
                              value={selectedElement.textAlign || "left"}
                              onChange={(e) =>
                                patch({
                                  textAlign: e.target
                                    .value as ElementTransform["textAlign"],
                                })
                              }
                            >
                              <option value="left">{t("왼쪽", "Left")}</option>
                              <option value="center">
                                {t("가운데", "Center")}
                              </option>
                              <option value="right">
                                {t("오른쪽", "Right")}
                              </option>
                            </select>
                          </label>
                          <label>
                            {t("기울임", "Italic")}
                            <input
                              type="checkbox"
                              checked={!!selectedElement.textItalic}
                              onChange={(e) =>
                                patch({ textItalic: e.target.checked })
                              }
                            />
                          </label>
                          {num(
                            t("두께", "Weight"),
                            selectedElement.textWeight ?? 400,
                            (v) => patch({ textWeight: v }),
                            100,
                          )}
                          {num(
                            t("줄 높이", "Line height"),
                            selectedElement.textLineHeight ?? 1,
                            (v) => patch({ textLineHeight: v }),
                            0.1,
                          )}
                          {num(
                            t("텍스트 너비", "Text width"),
                            selectedElement.textWidth ?? 50,
                            (v) => patch({ textWidth: v }),
                            1,
                          )}
                          {num(
                            t("자간", "Letter spacing"),
                            selectedElement.textSpacing ?? 0,
                            (v) => patch({ textSpacing: v }),
                            0.1,
                          )}
                          {num(
                            t("불투명도", "Opacity"),
                            selectedElement.textOpacity ?? 1,
                            (v) => patch({ textOpacity: v }),
                            0.1,
                          )}
                        </>
                      )}
                    </>
                  )
                )}
              </>
            ) : (
              <p>{t("레이어를 선택하세요.", "Select a layer.")}</p>
            )}
          </section>
          <section>
            <h2>{t("화면과 모양", "Screens and appearance")}</h2>
            <label>
              {t("논리 화면", "Logical screen")}
              <select
                value={look.logical_screen}
                onChange={(e) =>
                  change((l) => ({ ...l, logical_screen: e.target.value }))
                }
              >
                {look.state.screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("배경", "Background")}
              <select
                value={appearanceFor(look.state).mode}
                onChange={(e) =>
                  changeState((s) =>
                    patchAppearance(s, {
                      mode: e.target.value as "preset" | "solid" | "gradient",
                    }),
                  )
                }
              >
                <option value="preset">{t("원본", "Source")}</option>
                <option value="solid">{t("단색", "Solid")}</option>
                <option value="gradient">{t("그라디언트", "Gradient")}</option>
              </select>
            </label>
            {(["backgroundColor", "glowColor"] as const).map((k, i) => (
              <label key={k}>
                {i
                  ? t("빛 색상", "Glow color")
                  : t("배경 색상", "Background color")}
                <input
                  type="color"
                  value={appearanceFor(look.state)[k]}
                  onChange={(e) =>
                    changeState((s) =>
                      patchAppearance(s, { [k]: e.target.value }),
                    )
                  }
                />
              </label>
            ))}
            {(["glow", "lighting", "floor"] as const).map((k, i) =>
              num(
                [t("빛", "Glow"), t("조명", "Lighting"), t("바닥", "Floor")][i],
                appearanceFor(look.state)[k],
                (v) => changeState((s) => patchAppearance(s, { [k]: v })),
                0.1,
                k,
              ),
            )}
            {num(
              t("밝기", "Brightness"),
              look.state.brightness,
              (v) => changeState((s) => ({ ...s, brightness: v })),
              0.1,
            )}
            {num(
              t("전체 속도", "Overall speed"),
              look.state.speed,
              (v) => changeState((s) => ({ ...s, speed: v })),
              0.1,
            )}
            {num(t("시드", "Seed"), look.seed, (v) =>
              change((l) => ({ ...l, seed: v })),
            )}
            <label>
              {t("애니메이션 일시정지", "Pause animation")}
              <input
                type="checkbox"
                checked={look.state.paused}
                onChange={(e) =>
                  changeState((s) => ({ ...s, paused: e.target.checked }))
                }
              />
            </label>
            <label>
              {t("인터랙션", "Interaction")}
              <input
                type="checkbox"
                checked={look.state.interactive}
                onChange={(e) =>
                  changeState((s) => ({ ...s, interactive: e.target.checked }))
                }
              />
            </label>
          </section>
        </aside>
      </fieldset>
    </main>
  );
}
