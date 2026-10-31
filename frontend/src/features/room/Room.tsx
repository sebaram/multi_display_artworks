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
          if (!response.ok) throw Error("월을 새로고침하지 못했습니다.");
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
        if (!roomId) throw Error("전시 공간을 선택하세요.");
        value = await api(`/api/v1/rooms/${roomId}/scene?${query}`, {
          signal: abort.signal,
        });
      } else if (mode === "wall") {
        if (!wallId) throw Error("월을 선택하세요.");
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
        if (!elementId) throw Error("작품을 선택하세요.");
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
    <main className="room-view wall-display" aria-label={data?.room.name || "월 표시"}>
      <div className="scene-host" ref={host} data-testid="scene-host" />
      <div className="room-hud">
        <Status loading={loading || (!ready && !error)} error={error} />
        {notice && <p role="status">{notice}</p>}
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
          ← 전시 목록
        </Link>
        <div>
          <strong>{data?.room.name || "전시 공간"}</strong>
          <small>
            {ready
              ? "WASD / 방향키로 이동 · 드래그로 둘러보기"
              : "공간을 준비하고 있습니다"}
          </small>
        </div>
        <button aria-expanded={list} onClick={() => setList(!list)}>
          작품 목록 <span>{elements.length}</span>
        </button>
        <button
          onClick={async () => {
            await navigator.clipboard?.writeText(location.href);
            setStatus("전시 링크를 복사했습니다.");
          }}
        >
          링크 공유 ↗
        </button>
      </div>
      <div className="room-hud">
        <Status loading={loading} error={error} />
        {notice && (
          <div role="status" className="notice">
            {notice}
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {status && !draft && <p role="status">{status}</p>}
      </div>
      <div id="room-toolbar" className="room-toolbar" />
      <MobileJoystick key={route}
        disabled={!ready || !!draft || list || ai || !!youtube || captureLocation || !!data?.isArMarker || !!data?.isArCompanion}
        onMove={(forward, right) => instance.current?.move(forward, right)} />
      <div className="room-bottom">
        {session.is_admin &&
          videoWalls.map((wall) => (
            <SharedPlayback
              key={wall.id}
              wallId={wall.id}
              title={wall.name || "월"}
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
          {sound ? "소리 끄기" : "소리 켜기"}
        </button>
        <button
          onClick={() => {
            const scene = instance.current?.scene as any;
            if (scene?.enterVR) void scene.enterVR();
          }}
        >
          VR 입장
        </button>
        <select
          aria-label="지정 위치로 이동"
          defaultValue=""
          onChange={(e) => {
            const p = data?.presets.find((p) => p.id === e.target.value);
            if (p) instance.current?.teleport(p);
          }}
        >
          <option value="">위치 이동</option>
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
            현재 위치 저장
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
                setStatus("현재 위치를 저장했습니다.");
              } catch (reason) {
                if (routeRef.current === targetRoute)
                  setLocationError((reason as Error).message);
              } finally {
                if (routeRef.current === targetRoute) setSavingLocation(false);
              }
            }}
          >
            <label>
              장소 이름
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
                위치 저장
              </button>
              <button type="button" onClick={() => setCaptureLocation(false)}>
                취소
              </button>
            </div>
            {locationError && <p role="alert">{locationError}</p>}
          </form>
        )}
        {!!data?.roomId && (
          <Link to={`/room?room_id=${data.roomId}&ar=marker`}>마커 AR</Link>
        )}
        {!!data?.roomId && (
          <Link to={`/room?room_id=${data.roomId}&ar=companion`}>
            폰 연동 AR
          </Link>
        )}
        {session.is_admin && data?.roomId && (
          <button disabled={!ready} onClick={() => (ai ? closeAI() : openAI())}>
            AI 큐레이션
          </button>
        )}
        {session.is_admin && data?.walls[0]?.id && (
          <Link to={`/wall-editor?wall_id=${data?.walls[0]?.id || ""}`}>
            월 디자인 ↗
          </Link>
        )}
      </div>
      {list && (
        <aside className="artwork-list">
          <div className="section-heading">
            <h2>전시 작품</h2>
            <button onClick={() => setList(false)} aria-label="작품 목록 닫기">
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
                <small>{e.wall_element_type}</small>
              </span>
            </button>
          ))}
          {data?.walls
            .filter((w) => w.id)
            .map((w) => (
              <Link key={w.id} to={`/wall?wall_id=${w.id}`}>
                {w.name} 단독 보기 ↗
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
              <div className="eyebrow">ARTWORK / {draft.wall_element_type}</div>
              <h2>{draft.name}</h2>
            </div>
            <button
              onClick={() => setSelected(null)}
              aria-label="작품 정보 닫기"
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
            작품 단독 보기 ↗
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
            작품 원본 열기 ↗
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
                  };
                  instance.current?.update([saved]);
                  setStatus("저장했습니다.");
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
              <div className="form-section">작품 편집 · 월 기준 좌표 (m)</div>
              <label>
                작품 이름
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
                          position_x: "가로 X",
                          position_y: "세로 Y",
                          scale_x: "크기 X",
                          scale_y: "크기 Y",
                          scale_z: "크기 Z",
                          rotation_x: "회전 X°",
                          rotation_y: "회전 Y°",
                          rotation_z: "회전 Z°",
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
                    미디어 URL
                    <input
                      type="text"
                      inputMode="url"
                      ref={(input) =>
                        input?.setCustomValidity(
                          draft[f] && !safeMediaUrl(draft[f])
                            ? "HTTP(S) 주소 또는 상대 미디어 경로를 입력하세요."
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
                  깊이 Z (m)
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
              <p className="muted">방향키: 1cm 이동 · Shift: 10cm 이동</p>
              <button className="primary" disabled={busy}>
                {busy ? "저장 중…" : "작품 변경 저장"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (original) {
                    patch(original);
                    setStatus("변경을 되돌렸습니다.");
                  }
                }}
              >
                되돌리기
              </button>
            </form>
          )}
          {status && (
            <p role="status" className="notice">
              {status}
            </p>
          )}
          <div className="attribution">
            아바타: Shiba by zixisun02 · Rigged Simple by Cesium (CC BY 4.0)
          </div>
        </aside>
      )}
    </main>
  );
}
function Webpage({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const safe = safeMediaUrl(url);
  return (
    <section className="webpage-view">
      <button onClick={() => setOpen(!open)}>
        {open ? "웹페이지 닫기" : "웹페이지 플레이어 열기"}
      </button>
      {open && (
        <>
          <p>
            페이지가 보이지 않으면 사이트의 삽입 제한일 수 있습니다. 원본 링크를
            열어 확인하세요.
          </p>
          <iframe
            title="작품 웹페이지"
            src={safe}
            sandbox="allow-scripts allow-forms allow-presentation"
            referrerPolicy="no-referrer"
          />
          <a href={safe} target="_blank" rel="noopener noreferrer">
            원본 페이지 열기 ↗
          </a>
        </>
      )}
    </section>
  );
}
