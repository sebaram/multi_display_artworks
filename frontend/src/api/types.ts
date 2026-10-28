import type { components } from "./openapi";
export type DocumentDTO = components["schemas"]["DocumentDTO"] & {
  name?: string;
  description?: string;
  [key: string]: unknown;
};
export type ElementDTO = DocumentDTO & {
  wall_element_type: string;
  wall: string;
  position?: string;
  position_x?: number;
  position_y?: number;
  position_z?: number;
  default_rotation?: string;
  scale_x?: number;
  scale_y?: number;
  scale_z?: number;
  rotation_x?: number;
  rotation_y?: number;
  rotation_z?: number;
  image_url?: string;
  splat_url?: string;
  gltf_url?: string;
  url?: string;
  width?: number;
  height?: number;
};
export type WallDTO = DocumentDTO & {
  room: string;
  position: string;
  rotation: string;
  width: number;
  height: number;
  depth: number;
  surface_type?: string;
  color?: string;
  image_url?: string;
  video_url?: string;
  elements: ElementDTO[];
  design?: any;
};
export type RoomSummary = DocumentDTO & {
  walls: { id: string; name: string }[];
  created_time?: string;
};
export type RoomScene = {
  room: DocumentDTO;
  roomId: string;
  boundary: {
    min_x: number;
    max_x: number;
    min_y: number;
    max_y: number;
    min_z: number;
    max_z: number;
  };
  presets: any[];
  spawn_preset: any;
  walls: WallDTO[];
  wallList: any[];
  visitorCapabilityUrl: string;
  avatarCatalog: string[];
  isAdmin: boolean;
  syncDebugEnabled: boolean;
  isArMarker: boolean;
  isArCompanion: boolean;
  roomControlsEnabled: boolean;
};
export type SessionRead = components["schemas"]["SessionRead"] & {
  email?: string;
  name?: string;
};
export type FieldSpec = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  readonly: boolean;
  default?: unknown;
  choices?: any[];
  reference?: string;
  secret?: boolean;
};
export type ResourceSpec = { name: string; label: string; fields: FieldSpec[] };
