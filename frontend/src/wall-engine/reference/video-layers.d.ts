import type { SourceState, VideoLayer } from "../types";
export function placement(
  layer: VideoLayer,
  screenId: string,
  physicalAspect: number,
  sourceAspect?: number,
): VideoLayer & {
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
};
export function patchLayer(
  state: SourceState,
  id: string,
  patch: Partial<VideoLayer>,
  screen?: string,
): SourceState;
export function addLayer(
  state: SourceState,
  clip: { id: string | null },
  customClip?: { url: string; name: string },
): SourceState;
export function removeLayer(state: SourceState, id: string): SourceState;
export function duplicateVideo(
  state: SourceState,
  layer: VideoLayer,
): SourceState;
export function videoElements(
  state: SourceState,
  clips?: unknown[],
): Array<{
  id: string;
  layerId: string;
  video: true;
  name: string;
  parentId: null;
  depth: 0;
  screen: string;
  screenLabel: string;
  visible: boolean;
  motionSpeed: number;
  sourceKind: string;
}>;
export function assignVideoSource(
  state: SourceState,
  id: string,
  source: Partial<VideoLayer>,
): SourceState;
export function assignVideoScreens(
  state: SourceState,
  id: string,
  ids: string[],
): SourceState;
