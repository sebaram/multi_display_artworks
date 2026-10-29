export interface TextProperties {
  textHtml?: string; textFont?: 'sans'|'host'|'arial'|'serif'|'mono'|'malgun'; textSize?: number;
  textWeight?: number; textItalic?: boolean; textColor?: string; textAlign?: 'left'|'center'|'right';
  textWidth?: number; textLineHeight?: number; textSpacing?: number; textOpacity?: number;
}
export interface ElementTransform extends TextProperties {
  screen?: string; x?: number; y?: number; size?: number; rotation?: number; visible?: boolean;
  deleted?: boolean; ungrouped?: boolean; seed?: number; randomness?: number;
  motionSpeed?: number; motionAmount?: number; motionAnchor?: number; motionOffset?: number;
}
export interface SourceObject extends ElementTransform {id:string;type:string;source?:string|null;archived?:boolean}
export interface SourceScreen {id:string;name?:string;width:number;height:number;mode?:'raster'|'tiles'|'custom';cols?:number;rows?:number;tileW?:number;tileH?:number;aspectW?:number;aspectH?:number;grid?:boolean}
export interface VideoLayer {id:string;assetId?:string;videoId?:string|null;name?:string;fileName?:string;customClip?:{url:string;name:string};youtube?:{id:string;start:number;title:string};sourceAspect?:number;x?:number;y?:number;width?:number;enabled?:boolean;targets?:string[];screens?:Record<string,{x?:number;y?:number;width?:number;enabled?:boolean}>;motionSpeed?:number;motionAnchor?:number;motionOffset?:number}
export interface Appearance {mode?:'preset'|'solid'|'gradient';backgroundColor?:string;glowColor?:string;glow?:number;floor?:number;lighting?:number}
export interface SourceState {
  variant:number;cue:number;screens:SourceScreen[];authored:Record<string,{edits:Record<string,ElementTransform>;objects:SourceObject[]}>;
  videoLayers:VideoLayer[];appearance:Record<string,Appearance>;brightness:number;speed:number;motionAmount:number;
  paused:boolean;offset:number;epoch:number;branding:boolean;headlines:boolean;interactive:boolean;showVideo:boolean;
  guide?:boolean;calibration?:boolean;activeElement?:string|null;activeVideoLayer?:string|null;editElements?:boolean;editVideos?:boolean;
  [key:string]:unknown;
}
export interface WallLookV1 {schema_version:1;source_commit:string;logical_screen:string;seed:number;state:SourceState}
export interface PlaybackClock {positionSeconds:number;playing:boolean;rate:number}
export interface WallElement extends ElementTransform {
  id:string;name:string;type?:string;video?:boolean;layerId?:string;sourceKind?:string;parentId:string|null;rootId?:string;depth:number;owner?:string|null;custom:boolean;
  dom:boolean;text:boolean;textKind?:'text'|'signature'|'headline'|'footer';mv:boolean;animated:boolean;base:ElementTransform;
  clock?:{time:number;parentTime:number;amount:number;speed:number}|null;
}
export interface WallRendererError {code:string;message:string;layerId?:string}
export interface MediaStatus {id:string;ready:number;currentTime:number;paused:boolean;muted:boolean;blocked:boolean;failed:boolean}
export interface YouTubeLayer extends VideoLayer {placement:Record<string,unknown>;playback:PlaybackClock;composited:false}
export interface WallRenderer {
  setConfig(config:WallLookV1|Partial<SourceState>):void;
  resize(width:number,height:number):void;
  setInteraction(pointer:{x:number;y:number}):void;
  /** Local device audio preference. Call with false only from a user gesture. */
  setMuted(muted:boolean):void;
  /** Synchronize canonical media time without drawing, including while the wall is hidden. */
  syncPlayback(playback:PlaybackClock):void;
  /** Returns true only when the output canvas was repainted. */
  render(timeSeconds:number,playback?:PlaybackClock):boolean;
  getElements():WallElement[];
  /** Canvas coordinates in [0,1], origin at the top left. Returns the source grouping target. */
  pick(xNormalized:number,yNormalized:number):{id:string;name?:string}|null;
  getYouTubeLayers():YouTubeLayer[];
  getStats():{disposed:boolean;contextLost:boolean;timeSeconds:number;animatedObjects:number;media:MediaStatus[]};
  dispose():void;
}
export interface WallRendererOptions {canvas:HTMLCanvasElement;config:WallLookV1|Partial<SourceState>;assetResolver?:(assetId:string)=>string|Blob|Promise<string|Blob>;onError?:(error:WallRendererError)=>void}
