import type {SourceState,Appearance} from '../types';
export function appearanceFor(state:SourceState):Required<Appearance>;
export function patchAppearance(state:SourceState,patch:Appearance):SourceState;
export function lightAppearance(state:SourceState):boolean;
