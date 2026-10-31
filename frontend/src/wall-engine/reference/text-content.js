// Only canonical text markup is emitted. Input tags and attributes are never
// copied wholesale, so imported looks cannot introduce active HTML or resources.
export const textFonts={sans:{name:'Segoe UI / system sans',css:'"Segoe UI","Malgun Gothic",sans-serif'},host:{name:'Host Grotesk',css:'"Host Grotesk","Malgun Gothic",sans-serif'},arial:{name:'Arial',css:'Arial,"Malgun Gothic",sans-serif'},serif:{name:'Georgia / serif',css:'Georgia,"Times New Roman",serif'},mono:{name:'Atkinson / monospace',css:'"Atkinson Hyperlegible Mono",Consolas,monospace'},malgun:{name:'Malgun Gothic / Korean',css:'"Malgun Gothic",sans-serif'}};
const tags=new Set('p div span h1 h2 h3 h4 strong b em i u s br ul ol li sub sup blockquote'.split(' ')),blocked=new Set('script style iframe object embed svg math template noscript textarea title xmp plaintext'.split(' '));
const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
function entities(value){return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,key)=>{if(key[0]!=='#')return named[key.toLowerCase()];const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\ufffd';});}
export function escapeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function inlineStyle(raw){
 const match=raw.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);if(!match)return '';
 const result=new Map();for(const item of entities(match[1]??match[2]).split(';')){const i=item.indexOf(':');if(i<0)continue;const key=item.slice(0,i).trim().toLowerCase(),value=item.slice(i+1).trim().toLowerCase();let safe=false;
  if(key==='color')safe=/^#[\da-f]{3}(?:[\da-f]{3})?$/.test(value)||/^(?:red|blue|white|black|gray|grey|cyan|teal|navy|orange|yellow|green|transparent|currentcolor)$/.test(value);
  if(key==='font-weight')safe=/^(?:\d{3}|normal|bold)$/.test(value)&&(!/^\d/.test(value)||+value>=100&&+value<=900);
  if(key==='font-family')safe=/^(?:arial|georgia|times new roman|segoe ui|malgun gothic|host grotesk|atkinson hyperlegible mono|consolas|sans-serif|serif|monospace)$/.test(value);
  if(key==='font-style')safe=/^(?:normal|italic)$/.test(value);
  if(key==='text-decoration')safe=/^(?:none|underline|line-through)$/.test(value);
  if(key==='font-size')safe=/^(?:\d+(?:\.\d+)?|\.\d+)em$/.test(value)&&parseFloat(value)>=.2&&parseFloat(value)<=6||/^\d+(?:\.\d+)?px$/.test(value)&&parseFloat(value)>=6&&parseFloat(value)<=400;
  if(key==='text-align')safe=/^(?:left|center|right)$/.test(value);
  if(safe)result.set(key,value);
 }
 return [...result].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+':'+v).join(';');
}
export function sanitizeTextHtml(raw){
 if(typeof raw!=='string')return '';
 const source=raw.slice(0,32000),stack=[],suppressed=[];let out='',count=0;
 const tokens=source.match(/<!--[\s\S]*?(?:-->|$)|<\/?[a-z][^<>]*>|[^<]+|</gi)||[];
 for(const token of tokens){
  if(token.startsWith('<!--'))continue;
  const tag=token.match(/^<(\/?)\s*([a-z][\w-]*)\b([^>]*)>/i);
  if(tag){const closing=!!tag[1],name=tag[2].toLowerCase(),selfClosing=/\/\s*>$/.test(token);
   if(blocked.has(name)){if(closing){const i=suppressed.lastIndexOf(name);if(i>=0)suppressed.splice(i);}else if(!selfClosing)suppressed.push(name);continue;}
   if(suppressed.length||!tags.has(name))continue;
   if(closing){const i=stack.lastIndexOf(name);if(i>=0)while(stack.length>i)out+='</'+stack.pop()+'>';continue;}
   if(stack.length>=16||++count>300)continue;
   const style=inlineStyle(tag[3]),chunk='<'+name+(style?' style="'+escapeText(style)+'"':'')+'>';
   if(out.length+chunk.length>15744)break;out+=chunk;if(name!=='br')stack.push(name);
  }else if(!suppressed.length){const text=entities(token),safe=escapeText(text),remaining=15744-out.length;if(safe.length>remaining){out+=escapeText(text.slice(0,Math.floor(remaining/6)));break;}out+=safe;}
 }
 while(stack.length)out+='</'+stack.pop()+'>';return out;
}
const ranges={textSize:[6,400],textWeight:[100,900],textWidth:[5,100],textLineHeight:[.6,3],textSpacing:[-.1,1],textOpacity:[0,1]};
export const textPropertyKeys=['textHtml','textFont','textColor','textAlign','textItalic',...Object.keys(ranges)];
export function cleanTextProperties(raw={}){
 const out={};if(typeof raw.textHtml==='string')out.textHtml=sanitizeTextHtml(raw.textHtml);
 if(Object.hasOwn(textFonts,raw.textFont))out.textFont=raw.textFont;
 if(['left','center','right'].includes(raw.textAlign))out.textAlign=raw.textAlign;
 if(raw.textColor==='auto')out.textColor='auto';else if(typeof raw.textColor==='string'){let c=raw.textColor.toLowerCase();if(/^#[\da-f]{3}$/.test(c))c='#'+[...c.slice(1)].map(v=>v+v).join('');if(/^#[\da-f]{6}$/.test(c))out.textColor=c;}
 if('textItalic' in raw)out.textItalic=raw.textItalic===true;
 for(const [key,[min,max]] of Object.entries(ranges))if(raw[key]!==undefined&&raw[key]!==null&&raw[key]!==''&&Number.isFinite(+raw[key]))out[key]=Math.max(min,Math.min(max,+raw[key]));
 return out;
}
export function textDefaults(kind='text',cue={lab:'',ko:'',en:''}){
 let html='<p>Your text</p>';if(kind==='footer')html='<p>SPACE — PEOPLE — AI</p>';
 if(kind==='headline')html='<p style="font-size:0.4em">'+escapeText(cue.lab)+'</p><h1>'+escapeText(cue.ko)+'</h1><p style="font-size:0.35em">'+escapeText(cue.en)+'</p>';
 if(kind==='signature')html='<p>KAIST <span style="font-size:0.62em">GRADUATE SCHOOL OF METAVERSE</span></p>';
 return {textHtml:html,textFont:'sans',textSize:kind==='footer'?26:kind==='signature'?42:64,textWeight:kind==='footer'?400:kind==='signature'?650:400,textItalic:false,textColor:'auto',textAlign:'left',textWidth:kind==='signature'?100:60,textLineHeight:1.2,textSpacing:kind==='footer'?.1:0,textOpacity:kind==='footer'?.45:1};
}
