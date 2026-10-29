import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => [] as any[]);
// WebGL is unavailable in jsdom; keep the renderer and compositor real.
vi.mock("../../src/wall-engine/reference/scene.js", () => ({
  createSourceScene: ({ canvas }: { canvas: HTMLCanvasElement }) => {
    const source = {
      canvas,
      manifest: [],
      objectCount: 2,
      render: vi.fn(),
      resize: vi.fn(),
      setState: vi.fn(),
      setInteraction: vi.fn(),
      restore: vi.fn(),
      pick: () => null,
      dispose: vi.fn(),
    };
    sources.push(source);
    return source;
  },
}));

import { createWallRenderer } from "../../src/wall-engine/renderer.js";
import type { WallRenderer } from "../../src/wall-engine/types";

let renderers: WallRenderer[];
let contexts: Map<HTMLCanvasElement, any>;
let images: HTMLImageElement[];
let videos: HTMLVideoElement[];
let fontLoads: (() => void)[];
let failVideoDraw: boolean;

beforeEach(() => {
  sources.length = 0;
  renderers = [];
  contexts = new Map();
  images = [];
  videos = [];
  fontLoads = [];
  failVideoDraw = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, {
      clearRect: vi.fn(), drawImage: vi.fn((image) => { if (failVideoDraw && image instanceof HTMLVideoElement) throw new Error("CORS denied"); }),
      save() {}, restore() {}, translate() {}, scale() {},
      fillRect() {}, fillText: vi.fn(), createRadialGradient: () => ({ addColorStop() {} }),
    });
    return contexts.get(this);
  } as any);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLVideoElement) {
    if (!videos.includes(this)) videos.push(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLVideoElement) {
    if (!this.paused) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
      this.dispatchEvent(new Event("pause"));
    }
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLVideoElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    images.push(image);
    return image;
  });
  vi.stubGlobal("FontFace", class {
    load() { return new Promise<void>((resolve) => fontLoads.push(resolve)); }
  });
  Object.defineProperty(document, "fonts", { configurable: true, value: { add() {}, delete() {} } });
});

afterEach(() => {
  renderers.forEach((renderer) => renderer.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function wall(config: Record<string, unknown> = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const renderer = createWallRenderer({ canvas, config: { paused: true, ...config } });
  renderers.push(renderer);
  await flush();
  return { renderer, canvas, output: contexts.get(canvas), source: sources.at(-1) };
}

async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
function ready(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    duration: { configurable: true, value: 60 },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  });
  video.dispatchEvent(new Event("loadeddata"));
}
const paused = { positionSeconds: 4, playing: false, rate: 1 };
const videoConfig = { showVideo: true, videoLayers: [{ id: "clip", customClip: { url: "/clip.mp4", name: "Clip" } }] };

it("skips an unchanged source and repaints a new canonical source time", async () => {
  const { renderer, output, source } = await wall();
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  expect(output.drawImage).toHaveBeenCalledTimes(1);
  expect(source.render).toHaveBeenCalledTimes(1);
  expect(renderer.render(12, paused)).toBe(true);
  expect(source.render).toHaveBeenLastCalledWith(12);
  expect(renderer.render(12, paused)).toBe(false);
});

it("redraws a paused source after pointer, config, resize and context restoration", async () => {
  const { renderer, source } = await wall();
  renderer.render(4, paused);
  renderer.setInteraction({ x: 0.2, y: -0.1 });
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  renderer.setInteraction({ x: 0.2, y: -0.1 });
  expect(renderer.render(4, paused)).toBe(false);
  renderer.setConfig({ paused: true, brightness: 80 });
  expect(renderer.render(4, paused)).toBe(true);
  renderer.resize(480, 270);
  expect(renderer.render(4, paused)).toBe(true);
  source.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  expect(renderer.render(4, paused)).toBe(false);
  source.canvas.dispatchEvent(new Event("webglcontextrestored"));
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
});

it("repaints playing video independently of a paused source", async () => {
  const { renderer, output, source } = await wall(videoConfig);
  ready(videos[0]);
  const playing = { positionSeconds: 4, playing: true, rate: 1 };
  expect(renderer.render(4, playing)).toBe(true);
  await flush();
  expect(renderer.render(4, { ...playing, positionSeconds: 4.1 })).toBe(true);
  expect(videos[0].paused).toBe(false);
  expect(output.drawImage).toHaveBeenCalledTimes(2);
  expect(source.render).toHaveBeenCalledTimes(1);
  renderer.render(4, paused);
  expect(videos[0].paused).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
});

it("synchronizes hidden media and YouTube clocks before any canvas is rendered", async () => {
  const { renderer, output, source } = await wall({ ...videoConfig, videoLayers: [
    ...videoConfig.videoLayers, { id: "youtube", youtube: { id: "abcdefghijk", start: 0, title: "YouTube" } },
  ] });
  ready(videos[0]);
  renderer.setMuted(false);
  renderer.syncPlayback({ positionSeconds: 17, playing: true, rate: 2 });
  expect(renderer.getStats().media[0]).toMatchObject({ currentTime: 17, paused: false, muted: false });
  expect(renderer.getYouTubeLayers()[0].playback).toEqual({ positionSeconds: 17, playing: true, rate: 2 });
  expect(output.drawImage).not.toHaveBeenCalled();
  expect(source.render).not.toHaveBeenCalled();
  renderer.syncPlayback({ positionSeconds: 29, playing: false, rate: 1 });
  expect(renderer.getStats().media[0]).toMatchObject({ currentTime: 29, paused: true });
  expect(renderer.render(4, { positionSeconds: 29, playing: false, rate: 1 })).toBe(true);
  expect(renderer.render(4, { positionSeconds: 29, playing: false, rate: 1 })).toBe(false);
});

it("redraws async font and logo completion without rerendering the unchanged source", async () => {
  const { renderer, output, source } = await wall();
  renderer.render(4, paused);
  expect(renderer.render(4, paused)).toBe(false);
  fontLoads[0]();
  await flush();
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  images[0].dispatchEvent(new Event("load"));
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  expect(output.drawImage).toHaveBeenCalledTimes(3);
  expect(source.render).toHaveBeenCalledTimes(1);
});

it("redraws a paused video after asynchronous decoded-frame readiness and seeks", async () => {
  const { renderer, source } = await wall(videoConfig);
  renderer.render(4, paused);
  expect(renderer.render(4, paused)).toBe(false);
  ready(videos[0]);
  expect(renderer.render(4, paused)).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  renderer.syncPlayback({ ...paused, positionSeconds: 8 });
  expect(renderer.render(4, { ...paused, positionSeconds: 8 })).toBe(true);
  videos[0].dispatchEvent(new Event("seeked"));
  expect(renderer.render(4, { ...paused, positionSeconds: 8 })).toBe(true);
  expect(renderer.render(4, { ...paused, positionSeconds: 8 })).toBe(false);
  expect(source.render).toHaveBeenCalledTimes(1);
});

it("replaces a failed paused video composition with its error placeholder", async () => {
  const { renderer, source } = await wall(videoConfig);
  ready(videos[0]);
  failVideoDraw = true;
  renderer.render(4, paused);
  expect(renderer.getStats().media[0].failed).toBe(true);
  expect(renderer.render(4, paused)).toBe(true);
  expect([...contexts.values()].some((context) => context.fillText.mock.calls.some(([text]: string[]) => text === "Video unavailable"))).toBe(true);
  expect(renderer.render(4, paused)).toBe(false);
  expect(source.render).toHaveBeenCalledTimes(1);
});
