import {kineticPresets} from './preset-catalog.js';
const baseColors=['#050a16','#111626','#c7c7bd','#0b2029','#111626','#0b182c','#b4a28a','#102031',...kineticPresets.map(p=>p.background)];
const glowColors=['#388fff','#e36b88','#e5dfcd','#4eb6b0','#e36b88','#528bcc','#e9d7b4','#29465f',...kineticPresets.map(p=>p.glow)];
export function hexColor(value){
 if(typeof value!=='string')return null;let color=value.trim().toLowerCase();if(/^#[0-9a-f]{3}$/.test(color))color='#'+[...color.slice(1)].map(c=>c+c).join('');return /^#[0-9a-f]{6}$/.test(color)?color:null;
}
export function sanitizeAppearance(raw){
 const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
 for(let i=0;i<baseColors.length;i++){const input=raw[i];if(!input||typeof input!=='object'||Array.isArray(input))continue;const value={};
  if(['preset','gradient','solid'].includes(input.mode))value.mode=input.mode;
  for(const key of ['backgroundColor','glowColor']){const color=hexColor(input[key]);if(color)value[key]=color;}
  for(const [key,max] of [['glow',2],['lighting',2],['floor',1]])if(input[key]!==null&&input[key]!==undefined&&input[key]!==''&&Number.isFinite(+input[key]))value[key]=Math.min(max,Math.max(0,+input[key]));
  out[i]=value;
 }return out;
}
export function appearanceFor(state){return {mode:'preset',backgroundColor:baseColors[state.variant]||baseColors[0],glowColor:glowColors[state.variant]||glowColors[0],glow:1,lighting:1,floor:1,...sanitizeAppearance(state.appearance)[state.variant]};}
export function patchAppearance(state,patch){const preset=state.variant;return {...state,appearance:{...state.appearance,...sanitizeAppearance({[preset]:{...state.appearance?.[preset],...patch}})}};}
export function lightAppearance(state){
 const a=appearanceFor(state);if(a.mode==='preset')return [2,6].includes(state.variant)||!!kineticPresets.find(p=>p.id===state.variant)?.light;const rgb=a.backgroundColor.slice(1).match(/../g).map(c=>parseInt(c,16)/255);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.6;
}
