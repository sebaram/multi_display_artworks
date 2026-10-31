import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionContext } from "../../src/app/context";
const mocks = vi.hoisted(() => ({
  mount: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  api: vi.fn(),
  command: vi.fn(),
  youtubeMount: vi.fn(),
  youtubeDispose: vi.fn(),
}));
vi.mock("../../src/api/client", () => ({ api: mocks.api, write: mocks.write }));
vi.mock("../../src/scene/mountRoom", async (original) => ({
  ...(await original<typeof import("../../src/scene/mountRoom")>()),
  loadAFrame: async () => {},
  mountRoom: mocks.mount,
}));
vi.mock("../../src/scene/youtube", () => ({
  mountYouTube: () => {
    mocks.youtubeMount();
    return { dispose: mocks.youtubeDispose, unmute() {} };
  },
}));
import Room from "../../src/features/room/Room";
const element = (id: string) => ({
  id,
  wall: "w",
  wall_element_type: "image",
  name: id,
  position_x: 0,
  image_url: "http://localhost/a.png",
});
const design = (videoId?: string) => ({
  config: {
    state: {
      videoLayers: [
        {
          id: "video",
          assetId: videoId ? undefined : "asset",
          youtube: videoId ? { id: videoId } : undefined,
        },
      ],
    },
  },
});
function mount(artworks = [element("a"), element("b")]) {
  const data = {
    roomId: "r",
    room: { id: "r", name: "Room" },
    presets: [],
    walls: [
      {
        id: "w",
        name: "Wall",
        design: design(),
        elements: artworks,
      },
    ],
  };
  mocks.api.mockResolvedValue(data);
  mocks.mount.mockImplementation((args) => {
    args.services.onReady();
    return {
      scene: {},
      move() {},
      update: mocks.update,
      dispose: mocks.dispose,
      playbackCommand: mocks.command,
      getYouTubeClock: () => ({ playing: false, positionSeconds: 0, rate: 1 }),
      getCameraPose: () => ({
        position_x: 1,
        position_y: 1.6,
        position_z: 2,
        rotation_x: 0,
        rotation_y: 37,
        rotation_z: 0,
      }),
    };
  });
  return render(
    <MemoryRouter initialEntries={["/room?room_id=r"]}>
      <SessionContext.Provider
        value={{
          session: { authenticated: true, is_admin: true },
          reload: async () => {},
        }}
      >
        <Room />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("offers canonical controls for uploaded-video-only walls", async () => {
  mount();
  await screen.findByRole("button", { name: "Wall 공유 일시정지" });
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Wall 공유 일시정지" }));
  expect(mocks.command).toHaveBeenCalledWith("w", "pause", undefined);
});
it("captures a camera preset into the selector without remounting the scene", async () => {
  mount();
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "현재 위치 저장" }));
  fireEvent.change(screen.getByLabelText("장소 이름"), {
    target: { value: "Current viewpoint" },
  });
  mocks.write.mockResolvedValue({
    status: "success",
    preset: {
      id: "new-place",
      name: "Current viewpoint",
      position: "1 1.6 2",
      rotation: "0 37 0",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /^위치 저장$/ }));
  await screen.findByRole("option", { name: "Current viewpoint" });
  expect(mocks.write).toHaveBeenCalledWith(
    "/room/r/preset",
    "POST",
    expect.objectContaining({
      name: "Current viewpoint",
      position_x: 1,
      rotation_y: 37,
    }),
  );
  expect(mocks.mount).toHaveBeenCalledTimes(1);
});
it("does not install an old location response after route navigation", async () => {
  mount();
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "현재 위치 저장" }));
  fireEvent.change(screen.getByLabelText("장소 이름"), {
    target: { value: "Old viewpoint" },
  });
  let finish: (result: any) => void = () => {};
  mocks.write.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^위치 저장$/ }));
  fireEvent.click(screen.getByRole("link", { name: "← 전시 목록" }));
  await act(async () =>
    finish({ preset: { id: "old-place", name: "Old viewpoint" } }),
  );
  expect(screen.queryByText("현재 위치를 저장했습니다.")).toBeNull();
  expect(screen.queryByRole("option", { name: "Old viewpoint" })).toBeNull();
});
it("saves one returned document without remounting or losing another preview", async () => {
  mount();
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: /작품 목록/ }));
  fireEvent.click(screen.getByRole("button", { name: /a image/ }));
  fireEvent.change(screen.getByLabelText("가로 X"), {
    target: { value: "1.2" },
  });
  fireEvent.click(screen.getByRole("button", { name: /b image/ }));
  fireEvent.change(screen.getByLabelText("가로 X"), {
    target: { value: "2.3" },
  });
  mocks.write.mockResolvedValue({ ...element("b"), position_x: 2.25 });
  fireEvent.click(screen.getByRole("button", { name: "작품 변경 저장" }));
  await screen.findByText("저장했습니다.");
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(mocks.dispose).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "b", position_x: 2.25 }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: /a image/ }));
  expect(screen.getByLabelText("가로 X")).toHaveValue(1.2);
});
it("replaces and disposes an open YouTube player when live designs change", async () => {
  mount();
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
  const services = mocks.mount.mock.calls[0][0].services;
  act(() => services.onDesignChange("w", design("M7lc1UVf-VE")));
  fireEvent.click(screen.getByRole("button", { name: "▶ YouTube" }));
  await waitFor(() => expect(mocks.youtubeMount).toHaveBeenCalledTimes(1));
  act(() => services.onDesignChange("w", design("dQw4w9WgXcQ")));
  await waitFor(() => expect(mocks.youtubeMount).toHaveBeenCalledTimes(2));
  expect(mocks.youtubeDispose).toHaveBeenCalledTimes(1);
  act(() => services.onDesignChange("w", null));
  expect(mocks.youtubeDispose).toHaveBeenCalledTimes(2);
  act(() => services.onDesignChange("w", design("dQw4w9WgXcQ")));
  expect(mocks.youtubeMount).toHaveBeenCalledTimes(2);
});
it.each([
  "/static/image/dance_i.jpg",
  "static/splat/hail.splat",
  "https://example.test/art.png",
])(
  "saves supported media source %s unchanged through normal form validation",
  async (source) => {
    mount([{ ...element("a"), image_url: source }]);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /작품 목록/ }));
    fireEvent.click(screen.getByRole("button", { name: /a image/ }));
    fireEvent.change(screen.getByLabelText("가로 X"), {
      target: { value: "1.2" },
    });
    const save = screen.getByRole("button", { name: "작품 변경 저장" });
    expect(save.closest("form")!.checkValidity()).toBe(true);
    mocks.write.mockResolvedValue({
      ...element("a"),
      image_url: source,
      position_x: 1.2,
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        "/api/v1/admin/images/a",
        "PATCH",
        expect.objectContaining({ image_url: source, position_x: 1.2 }),
      ),
    );
  },
);
it.each(["javascript:alert(1)", "data:text/html,unsafe"])(
  "rejects unsupported media source %s",
  async (source) => {
    mount();
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /작품 목록/ }));
    fireEvent.click(screen.getByRole("button", { name: /a image/ }));
    fireEvent.change(screen.getByLabelText("미디어 URL"), {
      target: { value: source },
    });
    const save = screen.getByRole("button", { name: "작품 변경 저장" });
    expect(save.closest("form")!.checkValidity()).toBe(false);
    fireEvent.click(save);
    expect(mocks.write).not.toHaveBeenCalled();
  },
);
