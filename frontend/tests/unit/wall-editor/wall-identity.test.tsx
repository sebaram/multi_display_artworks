import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { normalizeWallLook } from "../../../src/wall-engine/index.js";
import { setLocale } from "../../../src/app/i18n";
const requests = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  renderer: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../../src/app/navigation", () => ({ useUnsavedChanges: () => {} }));
vi.mock("../../../src/api/client", () => ({
  api: requests.api,
  write: requests.write,
  ApiError: class extends Error {
    status = 409;
  },
}));
vi.mock("../../../src/wall-engine/index.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../src/wall-engine/index.js")>();
  return {
    ...real,
    createWallRenderer: requests.renderer.mockImplementation(() => ({
      setMuted() {},
      resize() {},
      render() {},
      setConfig() {},
      getElements() {
        return [];
      },
      dispose: requests.dispose,
      pick() {
        return null;
      },
    })),
  };
});
import WallEditor from "../../../src/features/wall-editor/WallEditor";
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const look = normalizeWallLook();
const binding = (revision: number) => ({
  revision,
  config: look,
  preset_id: null,
});
const room = {
  id: "room-1",
  name: "Room",
  walls: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
};
const wall = (id: string) => ({
  id,
  room: { id: "room-1", name: "Room" },
  width: 16,
  height: 9,
});
function setup(bLoad: ReturnType<typeof deferred<unknown[]>>) {
  setLocale("ko");
  requests.renderer.mockClear();
  requests.dispose.mockClear();
  requests.api.mockReset();
  requests.write.mockReset();
  requests.api.mockImplementation((url: string) => {
    if (url === "/api/v1/rooms") return Promise.resolve([room]);
    if (url === "/api/v1/wall-presets") return Promise.resolve([]);
    if (url === "/api/v1/walls/a") return Promise.resolve(wall("a"));
    if (url === "/api/v1/walls/a/design") return Promise.resolve(binding(1));
    if (url === "/api/v1/walls/b") return bLoad.promise.then((v) => v[0]);
    if (url === "/api/v1/walls/b/design")
      return bLoad.promise.then((v) => v[1]);
    throw Error(url);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ presets: [] }),
      }),
    ),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  render(<WallEditor wallId="a" />);
}
afterEach(() => {
  cleanup();
  setLocale("ko");
  vi.unstubAllGlobals();
});
describe("wall identity", () => {
  it("updates an existing wall notice when language changes without applying again", async () => {
    setup(deferred<unknown[]>());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "월에 적용" })).toBeEnabled(),
    );
    requests.write.mockResolvedValue(binding(2));
    fireEvent.click(screen.getByRole("button", { name: "월에 적용" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "현재 초안을 월에 적용했습니다.",
      ),
    );
    act(() => setLocale("en"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Applied the current draft to the wall.",
    );
    expect(requests.write).toHaveBeenCalledTimes(1);
  });

  it("keeps an unsaved wall draft, history and canvas when switching language", async () => {
    setup(deferred<unknown[]>());
    await waitFor(() => expect(screen.getByLabelText("밝기")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "My unsaved design" },
    });
    const originalBrightness = Number(
      (screen.getByLabelText("밝기") as HTMLInputElement).value,
    );
    const brightnessInput = screen.getByLabelText("밝기");
    fireEvent.change(brightnessInput, {
      target: { value: "1.4" },
    });
    const canvas = screen.getByLabelText("월 디자인 미리보기");
    const rendererCount = requests.renderer.mock.calls.length;
    const disposeCount = requests.dispose.mock.calls.length;

    brightnessInput.focus();
    act(() => setLocale("en"));

    expect(
      screen.getByRole("heading", { name: "Wall design studio" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveValue("My unsaved design");
    expect(screen.getByLabelText("Brightness")).toHaveValue(1.4);
    expect(screen.getByLabelText("Brightness")).toBe(brightnessInput);
    expect(document.activeElement).toBe(brightnessInput);
    expect(screen.getByText(/Unsaved draft/)).toBeTruthy();
    expect(screen.getByLabelText("Wall design preview")).toBe(canvas);
    expect(requests.renderer).toHaveBeenCalledTimes(rendererCount);
    expect(requests.dispose).toHaveBeenCalledTimes(disposeCount);
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByLabelText("Brightness")).toHaveValue(originalBrightness);
    expect(screen.getByLabelText("Name")).toHaveValue("My unsaved design");
    expect(requests.write).not.toHaveBeenCalled();

    act(() => setLocale("ko"));
    expect(screen.getByLabelText("이름")).toHaveValue("My unsaved design");
    expect(screen.getByLabelText("월 디자인 미리보기")).toBe(canvas);
  });
  it("normalizes the room summary, disables wall writes and editing until the selected binding loads", async () => {
    const b = deferred<unknown[]>();
    setup(b);
    await waitFor(() =>
      expect(screen.getByLabelText("방")).toHaveValue("room-1"),
    );
    expect(screen.getByLabelText("월")).toHaveValue("a");
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "b" } });
    expect(screen.getByRole("button", { name: "월에 적용" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "적용 제거" })).toBeDisabled();
    expect(screen.getByLabelText("밝기")).toBeDisabled();
    expect(requests.write).not.toHaveBeenCalled();
    b.resolve([wall("b"), binding(1)]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "월에 적용" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("월")).toHaveValue("b");
  });
  it("ignores a prior wall write response after selecting another wall", async () => {
    const b = deferred<unknown[]>();
    setup(b);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "월에 적용" })).toBeEnabled(),
    );
    const pending = deferred<unknown>();
    requests.write.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "월에 적용" }));
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "b" } });
    b.resolve([wall("b"), binding(7)]);
    await waitFor(() => expect(screen.getByText(/적용 버전 7/)).toBeTruthy());
    await act(async () => {
      pending.resolve(binding(99));
      await pending.promise;
    });
    expect(screen.getByText(/적용 버전 7/)).toBeTruthy();
    expect(screen.queryByText(/적용 버전 99/)).toBeNull();
  });
  it("ignores a remove response for a wall that is no longer selected", async () => {
    const b = deferred<unknown[]>();
    setup(b);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "적용 제거" })).toBeEnabled(),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pending = deferred<unknown>();
    requests.write.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "적용 제거" }));
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "b" } });
    b.resolve([wall("b"), binding(7)]);
    await waitFor(() => expect(screen.getByText(/적용 버전 7/)).toBeTruthy());
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    expect(screen.getByText(/적용 버전 7/)).toBeTruthy();
    expect(screen.queryByText("기존 배경으로 되돌렸습니다.")).toBeNull();
    vi.restoreAllMocks();
  });
  it("discards a delayed wall load after the selection changes again", async () => {
    const b = deferred<unknown[]>();
    setup(b);
    await waitFor(() => expect(screen.getByLabelText("월")).toHaveValue("a"));
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByText(/적용 버전 1/)).toBeTruthy());
    await act(async () => {
      b.resolve([wall("b"), binding(7)]);
      await b.promise;
    });
    expect(screen.getByLabelText("월")).toHaveValue("a");
    expect(screen.queryByText(/적용 버전 7/)).toBeNull();
  });
});
