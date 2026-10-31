import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import fixture from "../../public/avatars/catalog.fixture.json";
import { SessionContext } from "../../src/app/context";
import { loadAvatarCatalog } from "../../src/avatar/catalog";
import { normalizeAppearance } from "../../src/avatar/appearance";
import { bootstrapRoomProfile } from "../../src/scene/legacy/application.js";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  mount: vi.fn(),
  dispose: vi.fn(),
  realtime: vi.fn(),
}));
vi.mock("../../src/api/client", () => ({ api: mocks.api, write: mocks.write }));
vi.mock("../../src/scene/mountRoom", async (original) => ({
  ...(await original<typeof import("../../src/scene/mountRoom")>()),
  loadAFrame: async () => {},
  mountRoom: mocks.mount,
}));
vi.mock("../../src/scene/realtime", () => ({ startRealtime: mocks.realtime }));
import Room from "../../src/features/room/Room";

const artwork = {
  id: "art",
  wall: "w",
  wall_element_type: "image",
  name: "Artwork",
  description: "",
  position: "0 0 0",
  position_x: 0,
  position_y: 0,
  scale_x: 1,
  scale_y: 1,
  scale_z: 1,
  width: 2,
  height: 1,
  image_url: "/static/art.png",
};
const wall = {
  id: "w",
  room: { id: "r", name: "Room" },
  name: "Wall",
  description: "",
  position: "0 0 0",
  rotation: "0 0 0",
  width: 4,
  height: 3,
  depth: 0.1,
  elements: [artwork],
};
const head = (etag: string, status = 200) =>
  new Response(null, { status, headers: { ETag: etag } });
const profiles: ReturnType<typeof bootstrapRoomProfile>[] = [];

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))),
  );
  await loadAvatarCatalog();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/api/v1/walls/w") return wall;
    if (path === "/api/v1/walls/w2")
      return { ...wall, id: "w2", name: "Next wall" };
    if (path.startsWith("/api/v1/elements/")) return artwork;
    throw Error(`Unexpected request: ${path}`);
  });
  mocks.mount.mockImplementation(({ services }) => {
    services.onReady();
    return { scene: {}, move() {}, update() {}, dispose: mocks.dispose };
  });
});
afterEach(() => {
  profiles.splice(0).forEach((panel) => panel.destroy());
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function open(mode: "wall" | "element", query: string) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MemoryRouter initialEntries={[`/${mode}?${query}`]}>
        <SessionContext.Provider
          value={{
            session: { authenticated: true, is_admin: true },
            reload: async () => {},
          }}
        >
          <Link to="/wall?wall_id=w2&refresh=1">Next wall</Link>
          <Room mode={mode} />
        </SessionContext.Provider>
      </MemoryRouter>,
    );
  });
  return view;
}
async function tick(ms = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it.each(["wall", "element"] as const)(
  "preserves a saved humanoid on a name-only profile edit in %s view",
  async (mode) => {
    await open(
      mode,
      mode === "wall" ? "wall_id=w" : "wall_element_id=art&type=image",
    );
    const panel = bootstrapRoomProfile({
      bootstrapData: mocks.mount.mock.calls[0][0].bootstrap,
      visitorSession: {
        visitorId: "visitor",
        profile: {
          displayName: "Visitor",
          avatarId: "casual",
          color: "#123456",
          appearance: normalizeAppearance(
            { presetId: "casual", colors: { top: "#123456" } },
            fixture as any,
          ),
        },
      },
      document,
      persistAppearance: undefined,
      onCustomize: undefined,
    });
    profiles.push(panel);
    fireEvent.click(screen.getByRole("button", { name: "Visitor" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Renamed visitor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(panel.profile).toMatchObject({
      displayName: "Renamed visitor",
      avatarId: "casual",
      appearance: { presetId: "casual" },
    });
  },
);

it("conditionally refreshes a changed wall and leaves an unchanged scene mounted", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .mocked(globalThis.fetch)
    .mockResolvedValueOnce(head('"v1"'))
    .mockResolvedValueOnce(head('"v1"', 304))
    .mockResolvedValueOnce(head('"v1"'))
    .mockResolvedValueOnce(head('"v2"'));
  await open("wall", "wall_id=w&refresh=1");
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  await tick();
  expect(fetch).toHaveBeenLastCalledWith(
    "/wall?wall_id=w&refresh=1",
    expect.objectContaining({
      method: "HEAD",
      headers: { "If-None-Match": '"v1"' },
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  await tick();
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  mocks.api.mockResolvedValue({
    ...wall,
    name: "Changed wall",
    color: "#123456",
  });
  await tick();
  expect(screen.getByText("Changed wall")).toBeInTheDocument();
  expect(mocks.mount).toHaveBeenCalledTimes(2);
});

it("bounds a subsecond refresh to one second", async () => {
  vi.useFakeTimers();
  const fetch = vi.mocked(globalThis.fetch).mockResolvedValue(head('"v1"'));
  await open("wall", "wall_id=w&refresh=0.001");
  await tick(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retains an unsaved artwork draft while a wall refresh is pending", async () => {
  vi.useFakeTimers();
  vi.mocked(globalThis.fetch)
    .mockResolvedValueOnce(head('"v1"'))
    .mockResolvedValue(head('"v2"'));
  await open("wall", "wall_id=w&wall_element_id=art&refresh=1");
  fireEvent.change(screen.getByLabelText("작품 이름"), {
    target: { value: "Unsaved title" },
  });
  await tick();
  expect(screen.getByLabelText("작품 이름")).toHaveValue("Unsaved title");
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.mount).toHaveBeenCalledTimes(1);
});

it("does not install a refreshed wall when editing begins during its data request", async () => {
  vi.useFakeTimers();
  vi.mocked(globalThis.fetch)
    .mockResolvedValueOnce(head('"v1"'))
    .mockResolvedValue(head('"v2"'));
  await open("wall", "wall_id=w&wall_element_id=art&refresh=1");
  let finish!: (value: typeof wall) => void;
  mocks.api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await tick();
  fireEvent.change(screen.getByLabelText("작품 이름"), {
    target: { value: "Unsaved title" },
  });
  await act(async () => {
    finish({ ...wall, name: "Changed wall" });
  });
  expect(screen.getByLabelText("작품 이름")).toHaveValue("Unsaved title");
  expect(screen.queryByText("Changed wall")).toBeNull();
  expect(mocks.mount).toHaveBeenCalledTimes(1);
});

it.each(["navigate", "unmount"])(
  "aborts an in-flight wall poll on %s and ignores its late response",
  async (action) => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetch = vi
      .mocked(globalThis.fetch)
      .mockResolvedValueOnce(head('"v1"'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(head('"next"'));
    const view = await open("wall", "wall_id=w&refresh=1");
    await tick();
    const signal = fetch.mock.calls[1][1]!.signal!;
    if (action === "unmount") view.unmount();
    else
      await act(async () => {
        fireEvent.click(screen.getByRole("link", { name: "Next wall" }));
      });
    expect(signal.aborted).toBe(true);
    const requests = mocks.api.mock.calls.length;
    await act(async () => {
      finish(head('"stale"'));
    });
    expect(mocks.api).toHaveBeenCalledTimes(requests);
    if (action === "navigate")
      expect(
        screen.getByText("Next wall", { selector: "strong" }),
      ).toBeInTheDocument();
  },
);

it.each(["image", "webpage", "gltf", "gaussian_splat"])(
  "renders an unassigned %s without borrowing room authority",
  async (type) => {
    mocks.api.mockResolvedValue({
      ...artwork,
      wall: null,
      wall_element_type: type,
      scale_x: 2,
      scale_y: 3,
    });
    await open("element", `wall_element_id=art&type=${type}`);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    const { bootstrap, services } = mocks.mount.mock.calls[0][0];
    expect(bootstrap.roomId).toBe("");
    expect(bootstrap.walls[0]).toMatchObject({
      elements: [expect.objectContaining({ id: "art", wall: null })],
    });
    expect(bootstrap.walls[0].width).toBeGreaterThanOrEqual(4);
    expect(bootstrap.walls[0].height).toBeGreaterThanOrEqual(3);
    await services.startRealtime(
      {},
      bootstrap,
      () => {},
      new AbortController().signal,
    );
    expect(mocks.realtime).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "마커 AR" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AI 큐레이션" })).toBeNull();
    expect(screen.queryByRole("link", { name: "월 디자인 ↗" })).toBeNull();
  },
);

it("frames a large unassigned artwork without clamping its initial camera position", async () => {
  mocks.api.mockResolvedValue({
    ...artwork,
    wall: null,
    width: 20,
    height: 15,
    scale_x: 2,
  });
  await open("element", "wall_element_id=art&type=image");
  const { bootstrap } = mocks.mount.mock.calls[0][0];
  expect(bootstrap.walls[0].width).toBeGreaterThanOrEqual(40);
  const cameraZ = Number(bootstrap.spawn_preset.position.split(" ")[2]);
  expect(cameraZ).toBeGreaterThan(40);
  expect(cameraZ).toBeLessThanOrEqual(bootstrap.boundary.max_z);
});
