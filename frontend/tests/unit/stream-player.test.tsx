import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() {
      return true;
    }
    loadSource = hls.loadSource;
    attachMedia = hls.attachMedia;
    destroy = hls.destroy;
  },
}));
import { StreamPlayer } from "../../src/features/admin/Streams";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("waits for FFmpeg's playlist and uses MSE when a browser also advertises ambiguous native HLS", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  const mounted = render(<StreamPlayer url="/stream/playlist/owned" />);
  await waitFor(() => expect(hls.attachMedia).toHaveBeenCalled());
  expect(hls.loadSource).toHaveBeenCalledWith("/stream/playlist/owned");
  mounted.unmount();
  expect(hls.destroy).toHaveBeenCalledTimes(1);
});
