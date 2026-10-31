import type {WallLookV1,SourceState} from './types';
export const SOURCE_COMMIT:'b247fd238fe6cb2c8c860c77d13488b28b8a0290';
export const RENDERER_VERSION:'gsmv-wall-1';
export const SOURCE_LIMITS:Readonly<{customObjects:32;edits:4096;screens:8;videos:8}>;
export function normalizeWallLook(input?:WallLookV1|Partial<SourceState>):WallLookV1;
