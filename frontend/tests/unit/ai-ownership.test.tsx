import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { SessionContext } from "../../src/app/context";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  mount: vi.fn(),
  instances: [] as any[],
}));
vi.mock("../../src/api/client", () => ({ api: mocks.api, write: mocks.write }));
vi.mock("../../src/scene/mountRoom", () => ({
  loadAFrame: async () => {},
  safeMediaUrl: (value: string) => value || "",
  mountRoom: mocks.mount,
}));
import Room from "../../src/features/room/Room";

function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function room(id: string, name = `Room ${id}`) {
  return {
    roomId: id,
    room: { id, name },
    presets: [],
    walls: [
      {
        id: `wall-${id}`,
        name: `Wall ${id}`,
        elements: [
          {
            id: `art-${id}`,
            name: `Artwork ${id}`,
            wall: `wall-${id}`,
            wall_element_type: "image",
            image_url: "http://localhost/art.png",
            position_x: 0,
          },
        ],
      },
    ],
  };
}
const proposal = (id = "A", position = 1) => ({
  explanation: "Proposal ready",
  arrangements: [
    { element_id: `art-${id}`, wall_name: `Wall ${id}`, position_x: position },
  ],
});
function mount() {
  mocks.api.mockImplementation(async (path: string) =>
    room(path.includes("/rooms/B/") ? "B" : "A"),
  );
  mocks.write.mockImplementation(async (path: string) =>
    path === "/api/auto-layout" ? proposal() : { status: "success" },
  );
  mocks.mount.mockImplementation((args) => {
    const instance = {
      scene: {},
      move() {},
      update: vi.fn(),
      dispose: vi.fn(),
      playbackCommand: vi.fn(),
    };
    mocks.instances.push(instance);
    args.services.onReady();
    return instance;
  });
  render(
    <MemoryRouter initialEntries={["/room?room_id=A"]}>
      <SessionContext.Provider
        value={{
          session: { authenticated: true, is_admin: true },
          reload: async () => {},
        }}
      >
        <Link to="/room?room_id=A">Go A</Link>
        <Link to="/room?room_id=B">Go B</Link>
        <Room />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
}
async function openProposal() {
  await screen.findByText("Room A", { selector: "strong" });
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "AI 큐레이션" }));
  fireEvent.change(screen.getByLabelText("작품 배치나 공간 효과 요청"), {
    target: { value: "Arrange artworks" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^배치 제안$/ }));
  await screen.findByText("Proposal ready");
}
async function navigate(id: "A" | "B") {
  fireEvent.click(screen.getByRole("link", { name: `Go ${id}` }));
  await screen.findByText(`Room ${id}`, { selector: "strong" });
  await waitFor(() => expect(mocks.instances.at(-1)?.scene).toBeTruthy());
}
function editCurrent(id: string) {
  fireEvent.click(screen.getByRole("button", { name: /작품 목록/ }));
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`Artwork ${id} image`) }),
  );
  fireEvent.change(screen.getByLabelText("가로 X"), {
    target: { value: "4.2" },
  });
  return mocks.instances.at(-1);
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.instances.length = 0;
});

it.each([false, true])(
  "rejects an old scene refresh after A→B navigation (return to A: %s)",
  async (returnToA) => {
    mount();
    await openProposal();
    const refresh = deferred();
    mocks.api.mockReturnValueOnce(refresh.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "제안한 배치 저장·적용" }),
    );
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    await navigate("B");
    if (returnToA) await navigate("A");
    const id = returnToA ? "A" : "B";
    const current = editCurrent(id),
      updates = current.update.mock.calls.length;
    await act(async () => refresh.resolve(room("A", "STALE FIRST ROOM")));
    expect(screen.queryByText("STALE FIRST ROOM")).toBeNull();
    expect(screen.getByText(`Room ${id}`, { selector: "strong" })).toBeTruthy();
    expect(screen.getByLabelText("가로 X")).toHaveValue(4.2);
    expect(current.update).toHaveBeenCalledTimes(updates);
  },
);

it("rejects an apply callback whose POST finished after A→B→A", async () => {
  mount();
  await openProposal();
  const apply = deferred();
  mocks.write.mockReturnValueOnce(apply.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "제안한 배치 저장·적용" }),
  );
  await navigate("B");
  await navigate("A");
  const current = editCurrent("A"),
    reads = mocks.api.mock.calls.length,
    updates = current.update.mock.calls.length;
  await act(async () => apply.resolve({ status: "success" }));
  expect(mocks.api).toHaveBeenCalledTimes(reads);
  expect(current.update).toHaveBeenCalledTimes(updates);
  expect(screen.getByLabelText("가로 X")).toHaveValue(4.2);
});

it.each(["close", "navigate"])(
  "rejects a delayed preview after panel %s",
  async (action) => {
    mount();
    await screen.findByText("Room A", { selector: "strong" });
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    const request = deferred();
    mocks.write.mockReturnValueOnce(request.promise);
    fireEvent.click(screen.getByRole("button", { name: "AI 큐레이션" }));
    fireEvent.change(screen.getByLabelText("작품 배치나 공간 효과 요청"), {
      target: { value: "Old request" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^배치 제안$/ }));
    if (action === "navigate") await navigate("B");
    else {
      fireEvent.click(screen.getByRole("button", { name: "AI 패널 닫기" }));
      fireEvent.click(screen.getByRole("button", { name: "AI 큐레이션" }));
    }
    const current = editCurrent(action === "navigate" ? "B" : "A"),
      updates = current.update.mock.calls.length;
    await act(async () => request.resolve(proposal("A", 9)));
    expect(current.update).toHaveBeenCalledTimes(updates);
    expect(screen.getByLabelText("가로 X")).toHaveValue(4.2);
  },
);

it("still installs a same-room applied scene without remounting", async () => {
  mount();
  await openProposal();
  const saved = room("A", "Updated same room");
  saved.walls[0].elements[0].position_x = 3.4;
  mocks.api.mockResolvedValueOnce(saved);
  fireEvent.click(
    screen.getByRole("button", { name: "제안한 배치 저장·적용" }),
  );
  await screen.findByText("Updated same room", { selector: "strong" });
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(mocks.instances[0].update).toHaveBeenLastCalledWith(
    saved.walls[0].elements,
  );
});
