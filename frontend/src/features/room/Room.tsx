import { useI18n } from "../../app/i18n";
import { LanguageSwitcher } from "../../app/LanguageSwitcher";
import { localizeRoomMessage } from "./messages";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, write } from "../../api/client";
import type { ElementDTO, RoomScene, WallDTO } from "../../api/types";
import { useSession } from "../../app/context";
import { Status } from "../../app/ui";
import { loadAFrame, mountRoom, safeMediaUrl } from "../../scene/mountRoom";
import { startRealtime } from "../../scene/realtime";
import { startWallDisplay } from "../../scene/wall-display";
import { loadAvatarCatalog } from "../../avatar/catalog";
import AIPanel from "./AIPanel";
import { loadAR, mountAR } from "../../scene/ar";
import YouTubePanel from "./YouTubePanel";
import SharedPlayback from "./SharedPlayback";
import MobileJoystick from "./MobileJoystick";
const resources: Record<string, string> = {
  image: "images",
  gaussian_splat: "splats",
  gltf: "gltfs",
  webpage: "webpages",
};
async function standalone(wall: WallDTO, isAdmin: boolean, displayOnly = false): Promise<RoomScene> {
  const room =
    typeof wall.room === "string" ? wall.room : (wall.room as any)?.id || "";
  const extent = Math.max(20, Math.max(wall.width, wall.height) * 1.5);
  return {
    displayOnly,
    room: { id: room, name: wall.name, description: wall.description },
    roomId: room,
    boundary: {
      min_x: -extent,
      max_x: extent,
      min_y: -extent,
      max_y: extent,
      min_z: -extent,
      max_z: extent,
    },
    spawn_preset: {
      position: `0 0 ${Math.max(wall.width, wall.height) * 1.2}`,
      rotation: "0 0 0",
    },
    presets: [],
    walls: [{ ...wall, position: "0 0 0", rotation: "0 0 0" }],
    wallList: [],
    avatarCatalog: displayOnly ? [] : (await loadAvatarCatalog()).presets.map(
      (preset) => preset.id,
    ),
    visitorCapabilityUrl: "/visitor-capability",
    isAdmin: displayOnly ? false : isAdmin,
    syncDebugEnabled: false,
    isArMarker: false,
    isArCompanion: false,
    roomControlsEnabled: false,
  };
}
export default function Room({
  mode = "room",
}: {
  mode?: "room" | "wall" | "element";
}) {
  const { t } = useI18n();
  const typeLabels: Record<string, string> = {
    image: t("이미지", "Image"), gaussian_splat: t("가우시안 스플랫", "Gaussian splat"),
    gltf: t("3D 모델", "3D model"), webpage: t("웹페이지", "Webpage"),
  };
  const [ai, setAI] = useState(false);
  const [youtube, setYouTube] = useState<
    { wallId: string; layerId: string; route: string } | undefined
  >();
  const [liveDesigns, setLiveDesigns] = useState<Record<string, any>>({});
  const [params] = useSearchParams();
  const { session } = useSession();
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<ReturnType<typeof mountRoom> | null>(null);
  const [data, setData] = useState<RoomScene>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(
      params.get("wall_element_id"),
    ),
    [drafts, setDrafts] = useState<Record<string, ElementDTO>>({}),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [list, setList] = useState(false),
    [sound, setSound] = useState(false);
  const [sceneData, setSceneData] = useState<RoomScene>();
  const [captureLocation, setCaptureLocation] = useState(false),
    [locationName, setLocationName] = useState(""),
    [savingLocation, setSavingLocation] = useState(false),
    [locationError, setLocationError] = useState("");
  const dataRef = useRef(data);
  dataRef.current = data;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const aiPreview = useRef<ElementDTO[]>([]);
  const aiOwner = useRef<{
    route: string;
    query: string;
    roomId: string;
    scene: ReturnType<typeof mountRoom>;
  } | null>(null);
  const roomId = params.get("room_id"),
    wallId = params.get("wall_id"),
    elementId = params.get("wall_element_id"),
    type = params.get("type") || "image";
  const query = params.toString();
  const route = `${mode}?${query}`;
  const routeRef = useRef(route);
  routeRef.current = route;
  const designFor = (wall: WallDTO) =>
    liveDesigns[wall.id] === undefined ? wall.design : liveDesigns[wall.id];
  const videoWalls =
    data?.walls.filter(
      (wall) => designFor(wall)?.config?.state?.videoLayers?.length,
    ) || [];
  const youtubeLayers =
    data?.walls.flatMap((wall) =>
      (designFor(wall)?.config?.state?.videoLayers || [])
        .filter((layer: any) => layer.youtube?.id)
        .map((layer: any) => ({
          wallId: wall.id,
          layerId: layer.id,
          videoId: layer.youtube.id,
          title: layer.youtube.title || layer.name || "YouTube",
        })),
    ) || [];
  const youtubeSource =
    youtube?.route === route
      ? youtubeLayers.find(
          (layer) =>
            layer.wallId === youtube.wallId &&
            layer.layerId === youtube.layerId,
        )
      : undefined;
  useEffect(() => {
    if (youtube && !youtubeSource) setYouTube(undefined);
  }, [youtube, youtubeSource]);
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let etag: string | null = null;
    const refresh = Number(params.get("refresh"));
    const refreshMs =
      mode === "wall" && Number.isFinite(refresh) && refresh > 0
        ? Math.max(1, Math.min(3600, refresh)) * 1000
        : 0;
    const current = () => live && routeRef.current === route;
    const hasDraft = () =>
      Object.keys(draftsRef.current).length > 0 || !!aiOwner.current;
    const wallHead = () =>
      fetch(`/wall?${query}`, {
        method: "HEAD",
        credentials: "include",
        cache: "no-cache",
        signal: abort.signal,
        headers: etag ? { "If-None-Match": etag } : {},
      });
    function scheduleRefresh() {
      if (!refreshMs || !current()) return;
      timer = setTimeout(async () => {
        try {
          const response = await wallHead();
          if (!current() || response.status === 304) return;
          if (!response.ok) throw Error(t("월을 새로고침하지 못했습니다.", "Could not refresh the wall."));
          const nextEtag = response.headers.get("ETag");
          if ((nextEtag && nextEtag === etag) || hasDraft()) return;
          const wall = await api<WallDTO>(`/api/v1/walls/${wallId}`, {
            signal: abort.signal,
          });
          const value = await standalone(wall, session.is_admin, true);
          if (!current() || hasDraft()) return;
          etag = nextEtag;
          setData(value);
          setSceneData(value);
          setLiveDesigns({});
        } catch (reason) {
          if (current()) setNotice((reason as Error).message);
        } finally {
          scheduleRefresh();
        }
      }, refreshMs);
    }
    setLoading(true);
    setError("");
    setData(undefined);
    setSceneData(undefined);
    setReady(false);
    setDrafts({});
    setLiveDesigns({});
    setYouTube(undefined);
    setAI(false);
    aiOwner.current = null;
    setSound(false);
    setCaptureLocation(false);
    setLocationName("");
    setLocationError("");
    setSavingLocation(false);
    aiPreview.current = [];
    async function fetchData() {
      let value: RoomScene;
      if (mode === "room") {
        if (!roomId) throw Error(t("전시 공간을 선택하세요.", "Select an exhibition space."));
        value = await api(`/api/v1/rooms/${roomId}/scene?${query}`, {
          signal: abort.signal,
        });
      } else if (mode === "wall") {
        if (!wallId) throw Error(t("월을 선택하세요.", "Select a wall."));
        if (refreshMs) {
          try {
            const response = await wallHead();
            if (response.ok) etag = response.headers.get("ETag");
          } catch (reason) {
            if (!current()) return;
            setNotice((reason as Error).message);
          }
        }
        value = await standalone(
          await api(`/api/v1/walls/${wallId}`, { signal: abort.signal }),
          session.is_admin,
          true,
        );
      } else {
        if (!elementId) throw Error(t("작품을 선택하세요.", "Select an artwork."));
        const element = await api<ElementDTO>(
          `/api/v1/elements/${type}/${elementId}`,
          { signal: abort.signal },
        );
        const wall = element.wall
          ? await api<WallDTO>(`/api/v1/walls/${element.wall}`, {
              signal: abort.signal,
            })
          : {
              id: "",
              room: "",
              name: element.name,
              description: element.description,
              position: "0 0 0",
              rotation: "0 0 0",
              depth: 0.01,
              width: Math.max(
                1,
                Math.abs(element.position_x || 0) * 2 +
                  (element.width || 1.5) * Math.abs(element.scale_x ?? 1),
              ),
              height: Math.max(
                1,
                Math.abs(element.position_y || 0) * 2 +
                  (element.height || 1) * Math.abs(element.scale_y ?? 1),
              ),
              elements: [element],
            };
        value = await standalone(
          { ...wall, elements: [element] },
          session.is_admin,
        );
      }
      if (current()) {
        setData(value);
        setSceneData(value);
        setLoading(false);
        scheduleRefresh();
      }
    }
    void fetchData().catch((e) => {
      if (current()) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      live = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [mode, roomId, wallId, elementId, type, query, session.is_admin]);
  useEffect(() => {
    if (!sceneData || !host.current) return;
    const data = sceneData;
    let cancelled = false;
    void loadAFrame()
      .then(async () => {
        if (data.isArMarker) await loadAR();
      })
      .then(() => {
        if (cancelled || !host.current) return;
        instance.current = mountRoom({
          container: host.current,
          bootstrap: data,
          services: {
            startRealtime: (scene, bootstrap, events, signal) =>
              bootstrap.displayOnly
                ? startWallDisplay(bootstrap.walls[0].id, events, signal, setNotice)
                : bootstrap.roomId
                ? startRealtime(scene, bootstrap, events, signal)
                : undefined,
            onSelect: (id) => {
              setSelected(id);
              setStatus("");
            },
            onDrag: (id, patch) =>
              setDrafts((d) => ({
                ...d,
                [id]: {
                  ...(d[id] ||
                    (dataRef.current || data).walls
                      .flatMap((w) => w.elements)
                      .find((e) => e.id === id)!),
                  ...patch,
                },
              })),
            onError: setNotice,
            onReady: () => setReady(true),
            onDesignChange: (id, design) =>
              setLiveDesigns((previous) => ({ ...previous, [id]: design })),
          },
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      aiOwner.current = null;
      instance.current?.dispose();
      instance.current = null;
    };
  }, [sceneData]);
  const elements = data?.walls.flatMap((w) => w.elements) || [],
    original = elements.find((e) => e.id === selected),
    draft = selected ? drafts[selected] || original : undefined;
  useEffect(() => {
    instance.current?.select?.(selected);
  }, [selected, ready]);
  const panelOwner = aiOwner.current;
  function ownsAI(owner: typeof panelOwner) {
    return (
      !!owner &&
      aiOwner.current === owner &&
      routeRef.current === owner.route &&
      dataRef.current?.roomId === owner.roomId &&
      instance.current === owner.scene
    );
  }
  function openAI() {
    if (!data || !instance.current) return;
    aiOwner.current = {
      route,
      query,
      roomId: data.roomId,
      scene: instance.current,
    };
    setAI(true);
  }
  function closeAI() {
    if (ownsAI(aiOwner.current))
      aiOwner.current?.scene.update(aiPreview.current);
    aiOwner.current = null;
    aiPreview.current = [];
    setAI(false);
  }
  function patch(p: Partial<ElementDTO>) {
    if (!selected || !draft) return;
    const next = { ...draft, ...p };
    setDrafts((d) => ({ ...d, [selected]: next }));
    instance.current?.update([next]);
    setStatus("");
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        mode === "wall" ||
        !draft ||
        !session.is_admin ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const delta = e.shiftKey ? 0.1 : 0.01;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-delta, 0],
        ArrowRight: [delta, 0],
        ArrowUp: [0, delta],
        ArrowDown: [0, -delta],
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        patch({
          position_x: (draft.position_x || 0) + move[0],
          position_y: (draft.position_y || 0) + move[1],
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draft, selected, session.is_admin]);
  const youtubePanel = youtubeSource && (
    <YouTubePanel
      key={`${route}:${youtubeSource.wallId}:${youtubeSource.layerId}:${youtubeSource.videoId}`}
      {...youtubeSource}
      isAdmin={mode !== "wall" && session.is_admin}
      getClock={() => instance.current?.getYouTubeClock(youtubeSource.wallId, youtubeSource.layerId)}
      command={(action, position) => instance.current?.playbackCommand(youtubeSource.wallId, action, position) || false}
      onClose={() => setYouTube(undefined)}
    />
  );
  if (mode === "wall") return (
    <main className="room-view wall-display" aria-label={data?.room.name || t("월 표시", "Wall display")}>
      <div className="scene-host" ref={host} data-testid="scene-host" />
      <div className="room-hud">
        <Status loading={loading || (!ready && !error)} error={localizeRoomMessage(error)} />
        {notice && <p role="status">{localizeRoomMessage(notice)}</p>}
      </div>
      {!!youtubeLayers.length && <div className="room-bottom">
        {youtubeLayers.map(layer => <button key={`${layer.wallId}-${layer.layerId}`}
          onClick={() => setYouTube({ wallId: layer.wallId, layerId: layer.layerId, route })}>
          ▶ {layer.title}
        </button>)}
      </div>}
      {youtubePanel}
    </main>
  );
  return (
    <main className={`room-view ${draft ? "has-inspector" : ""}`}>
      <div className="scene-host" ref={host} data-testid="scene-host" />
      <div className="room-top">
        <Link className="room-back" to="/">
          {t("← 전시 목록", "← Exhibitions")}
        </Link>
        <div>
          <strong>{data?.room.name || t("전시 공간", "Exhibition space")}</strong>
          <small>
            {ready
              ? t("WASD / 방향키로 이동 · 드래그로 둘러보기", "Move with WASD / arrow keys · Drag to look around")
              : t("공간을 준비하고 있습니다", "Preparing the space")}
          </small>
        </div>
        <button aria-expanded={list} onClick={() => setList(!list)}>
          {t("작품 목록", "Artwork list")} <span>{elements.length}</span>
        </button>
        <button
          onClick={async () => {
            await navigator.clipboard?.writeText(location.href);
            setStatus(t("전시 링크를 복사했습니다.", "Exhibition link copied."));
          }}
        >
          {t("링크 공유 ↗", "Share link ↗")}
        </button>
      </div>
      <div className="room-hud">
        <Status loading={loading} error={localizeRoomMessage(error)} />
        {notice && (
          <div role="status" className="notice">
            {localizeRoomMessage(notice)}
            <button aria-label={t("알림 닫기", "Dismiss notification")} onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {status && !draft && <p role="status">{localizeRoomMessage(status)}</p>}
      </div>
      <div id="room-toolbar" className="room-toolbar"><LanguageSwitcher /></div>
      <MobileJoystick key={route}
        disabled={!ready || !!draft || list || ai || !!youtube || captureLocation || !!data?.isArMarker || !!data?.isArCompanion}
        onMove={(forward, right) => instance.current?.move(forward, right)} />
      <div className="room-bottom">
        {session.is_admin &&
          videoWalls.map((wall) => (
            <SharedPlayback
              key={wall.id}
              wallId={wall.id}
              title={wall.name || t("월", "Wall")}
              command={(id, action, position) =>
                instance.current?.playbackCommand(id, action, position) || false
              }
            />
          ))}
        {youtubeLayers.map((layer) => (
          <button
            key={`${layer.wallId}-${layer.layerId}`}
            onClick={() =>
              setYouTube({
                wallId: layer.wallId,
                layerId: layer.layerId,
                route,
              })
            }
          >
            ▶ {layer.title}
          </button>
        ))}
        <button
          onClick={() => {
            setSound(!sound);
            instance.current?.sound(!sound);
          }}
        >
          {sound ? t("소리 끄기", "Mute") : t("소리 켜기", "Enable sound")}
        </button>
        <button
          onClick={() => {
            const scene = instance.current?.scene as any;
            if (scene?.enterVR) void scene.enterVR();
          }}
        >
          {t("VR 입장", "Enter VR")}
        </button>
        <select
          aria-label={t("지정 위치로 이동", "Go to a saved location")}
          defaultValue=""
          onChange={(e) => {
            const p = data?.presets.find((p) => p.id === e.target.value);
            if (p) instance.current?.teleport(p);
          }}
        >
          <option value="">{t("위치 이동", "Go to location")}</option>
          {data?.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {session.is_admin && mode === "room" && (
          <button
            disabled={!ready}
            onClick={() => {
              setCaptureLocation(!captureLocation);
              setLocationError("");
            }}
          >
            {t("현재 위치 저장", "Save current location")}
          </button>
        )}
        {captureLocation && data && (
          <form
            className="location-capture"
            onSubmit={async (event) => {
              event.preventDefault();
              const pose = instance.current?.getCameraPose();
              if (!pose) return;
              const targetRoom = data.roomId,
                targetRoute = route;
              setSavingLocation(true);
              setLocationError("");
              try {
                const result = await write(
                  `/room/${targetRoom}/preset`,
                  "POST",
                  { name: locationName.trim(), ...pose, is_default: false },
                );
                if (
                  routeRef.current !== targetRoute ||
                  dataRef.current?.roomId !== targetRoom
                )
                  return;
                setData((current) =>
                  current?.roomId === targetRoom
                    ? {
                        ...current,
                        presets: [...current.presets, result.preset],
                      }
                    : current,
                );
                setCaptureLocation(false);
                setLocationName("");
                setStatus(t("현재 위치를 저장했습니다.", "Current location saved."));
              } catch (reason) {
                if (routeRef.current === targetRoute)
                  setLocationError((reason as Error).message);
              } finally {
                if (routeRef.current === targetRoute) setSavingLocation(false);
              }
            }}
          >
            <label>
              {t("장소 이름", "Location name")}
              <input
                required
                maxLength={160}
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="primary"
                disabled={savingLocation || !locationName.trim()}
              >
                {t("위치 저장", "Save location")}
              </button>
              <button type="button" onClick={() => setCaptureLocation(false)}>
                {t("취소", "Cancel")}
              </button>
            </div>
            {locationError && <p role="alert">{localizeRoomMessage(locationError)}</p>}
          </form>
        )}
        {!!data?.roomId && (
          <Link to={`/room?room_id=${data.roomId}&ar=marker`}>{t("마커 AR", "Marker AR")}</Link>
        )}
        {!!data?.roomId && (
          <Link to={`/room?room_id=${data.roomId}&ar=companion`}>
            {t("폰 연동 AR", "Phone-linked AR")}
          </Link>
        )}
        {session.is_admin && data?.roomId && (
          <button disabled={!ready} onClick={() => (ai ? closeAI() : openAI())}>
            {t("AI 큐레이션", "AI curation")}
          </button>
        )}
        {session.is_admin && data?.walls[0]?.id && (
          <Link to={`/wall-editor?wall_id=${data?.walls[0]?.id || ""}`}>
            {t("월 디자인 ↗", "Wall design ↗")}
          </Link>
        )}
      </div>
      {list && (
        <aside className="artwork-list">
          <div className="section-heading">
            <h2>{t("전시 작품", "Exhibited artworks")}</h2>
            <button onClick={() => setList(false)} aria-label={t("작품 목록 닫기", "Close artwork list")}>
              ×
            </button>
          </div>
          {elements.map((e) => (
            <button
              key={e.id}
              className={selected === e.id ? "selected" : ""}
              onClick={() => {
                setSelected(e.id);
                setStatus("");
              }}
            >
              <span>{e.wall_element_type === "image" ? "▧" : "◇"}</span>
              <span>
                {e.name}
                <small>{typeLabels[e.wall_element_type] || e.wall_element_type}</small>
              </span>
            </button>
          ))}
          {data?.walls
            .filter((w) => w.id)
            .map((w) => (
              <Link key={w.id} to={`/wall?wall_id=${w.id}`}>
                {t("{name} 단독 보기 ↗", "View {name} on its own ↗", { name: w.name || w.id })}
              </Link>
            ))}
        </aside>
      )}
      {ai && data && (
        <AIPanel
          roomId={data.roomId}
          onClose={closeAI}
          onApplied={async () => {
            const owner = panelOwner;
            if (!owner || !ownsAI(owner)) return;
            const saved = await api<RoomScene>(
              `/api/v1/rooms/${owner.roomId}/scene?${owner.query}`,
            );
            if (!ownsAI(owner)) return;
            owner.scene.update(saved.walls.flatMap((wall) => wall.elements));
            setData((current) =>
              ownsAI(owner) && current?.roomId === owner.roomId
                ? saved
                : current,
            );
            setDrafts((current) => (ownsAI(owner) ? {} : current));
            aiPreview.current = [];
          }}
          onPreview={(arrangements) => {
            if (!panelOwner || !ownsAI(panelOwner)) return;
            panelOwner.scene.update(aiPreview.current);
            const patches = arrangements.flatMap((a) => {
              const element = elements.find((e) => e.id === a.element_id);
              const wall = data.walls.find((wall) => wall.name === a.wall_name);
              return element && wall
                ? [
                    {
                      ...(drafts[element.id] || element),
                      ...a,
                      id: element.id,
                      wall: wall.id,
                    },
                  ]
                : [];
            });
            aiPreview.current = patches.map(
              (patch) =>
                drafts[patch.id] ||
                elements.find((element) => element.id === patch.id)!,
            );
            panelOwner.scene.update(patches);
          }}
        />
      )}
      {youtubePanel}
      {draft && (
        <aside className="inspector room-inspector">
          <div className="section-heading">
            <div>
              <div className="eyebrow">{t("작품", "ARTWORK")} / {typeLabels[draft.wall_element_type] || draft.wall_element_type}</div>
              <h2>{draft.name}</h2>
            </div>
            <button
              onClick={() => setSelected(null)}
              aria-label={t("작품 정보 닫기", "Close artwork details")}
            >
              ×
            </button>
          </div>
          <p>{draft.description}</p>
          {draft.wall_element_type === "image" && (
            <img
              className="artwork-preview"
              alt={draft.name}
              src={safeMediaUrl(draft.image_url)}
            />
          )}
          <Link
            to={`/element?wall_element_id=${draft.id}&type=${draft.wall_element_type}`}
          >
            {t("작품 단독 보기 ↗", "View artwork on its own ↗")}
          </Link>
          {draft.wall_element_type === "webpage" && (
            <Webpage url={String(draft.webpage_url || draft.url || "")} />
          )}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={safeMediaUrl(
              draft.image_url ||
                draft.splat_url ||
                draft.gltf_url ||
                draft.webpage_url,
            )}
          >
            {t("작품 원본 열기 ↗", "Open original artwork ↗")}
          </a>
          {session.is_admin && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setStatus("");
                try {
                  const fields = [
                    "position_x",
                    "position_y",
                    ...(draft.wall_element_type === "gltf"
                      ? ["position_z"]
                      : []),
                    "scale_x",
                    "scale_y",
                    "scale_z",
                    "rotation_x",
                    "rotation_y",
                    "rotation_z",
                    "name",
                    "description",
                    "image_url",
                    "splat_url",
                    "gltf_url",
                    "webpage_url",
                  ];
                  const body = Object.fromEntries(
                    fields
                      .filter((f) => draft[f] !== undefined)
                      .map((f) => [f, draft[f]]),
                  );
                  const saved: ElementDTO = {
                    ...draft,
                    ...(await write(
                      `/api/v1/admin/${resources[draft.wall_element_type]}/${draft.id}`,
                      "PATCH",
                      body,
                    )),
                    wall: draft.wall,
                  };
                  instance.current?.update([saved]);
                  setStatus(t("저장했습니다.", "Saved."));
                  setDrafts((d) => {
                    const next = { ...d };
                    delete next[draft.id];
                    return next;
                  });
                  if (data)
                    setData(
                      (current) =>
                        current && {
                          ...current,
                          walls: current.walls.map((w) => ({
                            ...w,
                            elements: w.elements.map((e) =>
                              e.id === draft.id ? saved : e,
                            ),
                          })),
                        },
                    );
                } catch (err) {
                  setStatus(
                    `저장하지 못했습니다. 입력은 유지됩니다. ${(err as Error).message}`,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LanguageSwitcher />
              <div className="form-section">{t("작품 편집 · 월 기준 좌표 (m)", "Edit artwork · Wall coordinates (m)")}</div>
              <label>
                {t("작품 이름", "Artwork name")}
                <input
                  value={draft.name || ""}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <div className="field-grid">
                {[
                  "position_x",
                  "position_y",
                  "scale_x",
                  "scale_y",
                  "scale_z",
                  "rotation_x",
                  "rotation_y",
                  "rotation_z",
                ].map((field) => (
                  <label key={field}>
                    {
                      (
                        {
                          position_x: t("가로 X", "Horizontal X"),
                          position_y: t("세로 Y", "Vertical Y"),
                          scale_x: t("크기 X", "Scale X"),
                          scale_y: t("크기 Y", "Scale Y"),
                          scale_z: t("크기 Z", "Scale Z"),
                          rotation_x: t("회전 X°", "Rotation X°"),
                          rotation_y: t("회전 Y°", "Rotation Y°"),
                          rotation_z: t("회전 Z°", "Rotation Z°"),
                        } as Record<string, string>
                      )[field]
                    }
                    <input
                      type="number"
                      step={field.startsWith("rotation") ? 1 : 0.01}
                      value={Number(
                        draft[field] ?? (field.startsWith("scale") ? 1 : 0),
                      )}
                      onChange={(e) =>
                        patch({ [field]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              {["image_url", "splat_url", "gltf_url", "webpage_url"]
                .filter((f) => draft[f] !== undefined)
                .map((f) => (
                  <label key={f}>
                    {t("미디어 URL", "Media URL")}
                    <input
                      type="text"
                      inputMode="url"
                      ref={(input) =>
                        input?.setCustomValidity(
                          draft[f] && !safeMediaUrl(draft[f])
                            ? t("HTTP(S) 주소 또는 상대 미디어 경로를 입력하세요.", "Enter an HTTP(S) URL or relative media path.")
                            : "",
                        )
                      }
                      value={String(draft[f] || "")}
                      onChange={(e) => patch({ [f]: e.target.value })}
                    />
                  </label>
                ))}
              {draft.wall_element_type === "gltf" && (
                <label>
                  {t("깊이 Z (m)", "Depth Z (m)")}
                  <input
                    type="number"
                    step={0.01}
                    value={draft.position_z ?? 0}
                    onChange={(event) =>
                      patch({ position_z: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              <p className="muted">{t("방향키: 1cm 이동 · Shift: 10cm 이동", "Arrow keys: move 1 cm · Shift: move 10 cm")}</p>
              <button className="primary" disabled={busy}>
                {busy ? t("저장 중…", "Saving…") : t("작품 변경 저장", "Save artwork changes")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (original) {
                    patch(original);
                    setStatus(t("변경을 되돌렸습니다.", "Changes reverted."));
                  }
                }}
              >
                {t("되돌리기", "Revert")}
              </button>
            </form>
          )}
          {status && (
            <p role="status" className="notice">
              {localizeRoomMessage(status)}
            </p>
          )}
          <div className="attribution">
            {t("아바타: Shiba by zixisun02 · Rigged Simple by Cesium (CC BY 4.0)", "Avatars: Shiba by zixisun02 · Rigged Simple by Cesium (CC BY 4.0)")}
          </div>
        </aside>
      )}
    </main>
  );
}
function Webpage({ url }: { url: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const safe = safeMediaUrl(url);
  return (
    <section className="webpage-view">
      <button onClick={() => setOpen(!open)}>
        {open ? t("웹페이지 닫기", "Close webpage") : t("웹페이지 플레이어 열기", "Open webpage player")}
      </button>
      {open && (
        <>
          <p>
            {t("페이지가 보이지 않으면 사이트의 삽입 제한일 수 있습니다. 원본 링크를 열어 확인하세요.", "If the page does not appear, the site may block embedding. Open the original link to check.")}
          </p>
          <iframe
            title={t("작품 웹페이지", "Artwork webpage")}
            src={safe}
            sandbox="allow-scripts allow-forms allow-presentation"
            referrerPolicy="no-referrer"
          />
          <a href={safe} target="_blank" rel="noopener noreferrer">
            {t("원본 페이지 열기 ↗", "Open original page ↗")}
          </a>
        </>
      )}
    </section>
  );
}
