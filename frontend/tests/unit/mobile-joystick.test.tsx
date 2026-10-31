import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionContext } from "../../src/app/context";

const scene = vi.hoisted(() => ({ move: vi.fn(), dispose: vi.fn() }));
vi.mock("../../src/api/client", () => ({
  api: async () => ({ roomId: "r", room: { id: "r", name: "Room" }, walls: [], presets: [] }),
  write: vi.fn(),
}));
vi.mock("../../src/scene/mountRoom", () => ({
  loadAFrame: async () => {},
  safeMediaUrl: (url: string) => url,
  mountRoom: ({ services }: any) => {
    services.onReady();
    return { ...scene, scene: {}, select() {} };
  },
}));
import Room from "../../src/features/room/Room";

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-joystick-test-style]").forEach(node => node.remove());
  vi.clearAllMocks();
});

async function openRoom() {
  const style = document.createElement("style");
  style.dataset.joystickTestStyle = "true";
  style.textContent = ".mobile-joystick { position: absolute; }";
  document.body.append(style);
  const view = render(<MemoryRouter initialEntries={["/room?room_id=r"]}>
    <SessionContext.Provider value={{ session: { authenticated: false, is_admin: false }, reload: async () => {} }}>
      <Room />
    </SessionContext.Provider>
  </MemoryRouter>);
  const zone = await screen.findByRole("group", { name: "이동 조이스틱" });
  await waitFor(() => expect(zone).not.toHaveAttribute("aria-disabled", "true"));
  return { ...view, zone };
}

function drag(zone: HTMLElement, x: number, y: number) {
  fireEvent.mouseDown(zone, { clientX: 100, clientY: 120, buttons: 1 });
  fireEvent.mouseMove(document, { clientX: x, clientY: y, buttons: 1 });
}

it("moves proportionally in any direction, ignores central jitter, and stops on release", async () => {
  const { zone } = await openRoom();
  drag(zone, 100, 92);
  const slow = scene.move.mock.lastCall!;
  expect(slow[0]).toBeGreaterThan(0);
  expect(slow[0]).toBeLessThan(1);
  expect(slow[1]).toBeCloseTo(0);
  fireEvent.mouseMove(document, { clientX: 180, clientY: 40, buttons: 1 });
  const diagonal = scene.move.mock.lastCall!;
  expect(diagonal[0]).toBeGreaterThan(slow[0]);
  expect(diagonal[1]).toBeGreaterThan(0);
  expect(Math.hypot(...diagonal)).toBeCloseTo(1);
  fireEvent.mouseMove(document, { clientX: 102, clientY: 118, buttons: 1 });
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
  fireEvent.mouseMove(document, { clientX: 100, clientY: 65, buttons: 1 });
  fireEvent.mouseUp(document);
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
});

it("stops on app focus loss and ignores the abandoned drag until a fresh touch", async () => {
  const { zone, unmount } = await openRoom();
  drag(zone, 100, 64);
  fireEvent(window, new Event("blur"));
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
  scene.move.mockClear();
  fireEvent.mouseMove(document, { clientX: 160, clientY: 70, buttons: 1 });
  expect(scene.move).not.toHaveBeenCalled();
  fireEvent.mouseUp(document);
  unmount();
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
  scene.move.mockClear();
  fireEvent.mouseMove(document, { clientX: 150, clientY: 60, buttons: 1 });
  expect(scene.move).not.toHaveBeenCalled();
});

it("stops when a room panel or modal is opened", async () => {
  const { zone } = await openRoom();
  drag(zone, 100, 64);
  fireEvent.click(screen.getByRole("button", { name: /^작품 목록 \d/ }));
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
  expect(zone).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("button", { name: "작품 목록 닫기" }));
  fireEvent.mouseUp(document);
  drag(zone, 100, 64);
  const dialog = document.createElement("dialog");
  dialog.open = true;
  const field = document.createElement("input");
  dialog.append(field); document.body.append(dialog);
  fireEvent.focusIn(field);
  expect(scene.move).toHaveBeenLastCalledWith(0, 0);
  dialog.remove();
});
