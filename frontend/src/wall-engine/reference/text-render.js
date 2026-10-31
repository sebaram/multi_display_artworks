import {textFonts,textDefaults,textPropertyKeys,sanitizeTextHtml,escapeText} from './text-content.js';

const lastContent=new WeakMap();
export function applyTextContent(target,settings,{kind='text',cue,authored={},height=1080}={}){
 if(!target?.ownerDocument)return;
 const custom=kind==='text'||textPropertyKeys.some(key=>Object.hasOwn(authored,key)),values={...textDefaults(kind,cue),...settings};
 let html;
 if(custom)html=sanitizeTextHtml(values.textHtml);
 else if(kind==='headline')html='<span id="cue-index">'+escapeText(cue.lab)+'</span><h1 id="cue-title">'+escapeText(cue.ko)+'</h1><p id="cue-en">'+escapeText(cue.en)+'</p>';
 else if(kind==='signature')html='KAIST <span>GRADUATE SCHOOL OF METAVERSE</span>';
 else html='<span>SPACE</span><i></i><span>PEOPLE</span><i></i><span>AI</span>';
 if(lastContent.get(target)!==html){target.innerHTML=html;lastContent.set(target,html);for(const node of target.querySelectorAll('[style]'))if(/^\d+(?:\.\d+)?px$/.test(node.style.fontSize))node.style.fontSize='calc(var(--wall-text-unit) * '+parseFloat(node.style.fontSize)+')';}
 target.style.setProperty('--wall-text-unit',height/2160+'px');
 target.dataset.textLayer=kind;target.classList.toggle('authored-rich-text',custom);
 const style=target.style;
 for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','color','textAlign','width','lineHeight','letterSpacing','opacity','maxWidth'])style[key]='';
 if(!custom)return;
 style.fontFamily=textFonts[values.textFont]?.css||textFonts.sans.css;style.fontSize=values.textSize/2160*height+'px';style.fontWeight=values.textWeight;style.fontStyle=values.textItalic?'italic':'normal';style.color=values.textColor==='auto'?'':values.textColor;style.textAlign=values.textAlign;style.width=values.textWidth+'%';style.lineHeight=values.textLineHeight;style.letterSpacing=values.textSpacing+'em';style.opacity=values.textOpacity;style.maxWidth='none';
}
