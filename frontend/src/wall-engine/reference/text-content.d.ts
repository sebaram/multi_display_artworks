import type {TextProperties} from '../types';
export const textFonts:Record<string,{name:string;css:string}>;
export function textDefaults(kind?:string,cue?:unknown):Required<TextProperties>;
export function sanitizeTextHtml(input:string):string;
export function cleanTextProperties(input:TextProperties):TextProperties;
