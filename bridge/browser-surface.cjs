'use strict';
const {createHash}=require('node:crypto');
const modifiers=new Set(['shift','control','alt','meta']);
const keys=new Set(['Backspace','Delete','Enter','Tab','Escape','Left','Right','Up','Down','Home','End','PageUp','PageDown','Insert']);
function inputEvent(value){
 if(!value||typeof value!=='object')throw Error('Invalid browser input');
 const mods=value.modifiers??[];
 if(!Array.isArray(mods)||mods.length>4||mods.some(m=>!modifiers.has(m)))throw Error('Invalid input modifiers');
 if(value.type==='keyDown'||value.type==='keyUp'){
  if(typeof value.keyCode!=='string'||!(keys.has(value.keyCode)||/^[ -~]$/.test(value.keyCode)))throw Error('Unsupported browser key');
  return {type:value.type,keyCode:value.keyCode,modifiers:mods};
 }
 if(!['mouseDown','mouseUp','mouseMove','mouseWheel'].includes(value.type))throw Error('Unsupported browser input');
 if(![value.x,value.y].every(n=>Number.isFinite(n)&&n>=0&&n<=8192))throw Error('Invalid input coordinates');
 const result={type:value.type,x:Math.round(value.x),y:Math.round(value.y),modifiers:mods};
 if(value.type==='mouseWheel'){
  if(![value.deltaX,value.deltaY].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))throw Error('Invalid scroll delta');
  return {...result,deltaX:value.deltaX,deltaY:value.deltaY,canScroll:true};
 }
 if(!['left','middle','right'].includes(value.button??'left'))throw Error('Invalid mouse button');
 return {...result,button:value.button??'left',clickCount:value.clickCount===2?2:1};
}
module.exports=function createSurface({getGuest,isOwner,now=Date.now}){
 const captures=new Map(),typing=new WeakMap();let inflight=0;
 return async function request(sender,value){
  if(!isOwner(sender,value?.session))throw Error('Browser connection changed');
  const guest=getGuest(value?.guestId);
  if(!guest||guest.isDestroyed()||guest.getType()!=='webview'||guest.hostWebContents?.id!==sender.id)throw Error('Browser page unavailable');
  if(value.action==='frame'){
   let cached=captures.get(guest.id);
   if(!cached||now()-cached.at>250){
    if(!cached?.pending){
     if(inflight>=2)throw Error('Browser capture busy');
     cached={at:-Infinity,pending:null};captures.delete(guest.id);captures.set(guest.id,cached);
     while(captures.size>8)captures.delete(captures.keys().next().value);
     inflight++;
     cached.pending=Promise.resolve().then(async()=>{
      try{
       let image=await guest.capturePage();
       if(image.isEmpty())throw Error('Browser page has no frame yet');
       const size=image.getSize();
       if(size.width>1600)image=image.resize({width:1600});
       const bytes=image.toJPEG(72);
       if(bytes.length>4*1024*1024)throw Error('Browser frame too large');
       cached.frame={bytes,revision:createHash('sha256').update(bytes).digest('hex')};cached.at=now();
       return cached.frame;
      }finally{inflight--;cached.pending=null;}
     });
    }
   }
   const frame=await (cached.pending??cached.frame);
   if(!isOwner(sender,value.session)||guest.isDestroyed())throw Error('Browser connection changed');
   return frame.revision===value.revision?{revision:frame.revision}:{...frame};
  }
  if(value.action==='text'){
   if(typeof value.text!=='string'||value.text.length>65536)throw Error('Invalid browser text');
   // This shipped Electron lacks sandboxed webFrame.insertText and rejects
   // non-ASCII char events. Use Chromium's text input, including focused frames.
   // Reuse an existing browser-tool debugger; detach only our own attachment.
   const pending=(typing.get(guest)??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(!isOwner(sender,value.session)||guest.isDestroyed())throw Error('Browser connection changed');
    const debug=guest.debugger,attached=debug.isAttached();
    if(!attached)debug.attach('1.3');
    try{guest.focus();await debug.sendCommand('Input.insertText',{text:value.text});}
    finally{if(!attached&&!guest.isDestroyed()&&debug.isAttached())debug.detach();}
   });
   typing.set(guest,pending);return pending;
  }
  if(value.action==='selection')return guest.executeJavaScript(`(()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;if(e?.tagName==='TEXTAREA'||e?.tagName==='INPUT'){if(e.type==='password')return '';return typeof e.selectionStart==='number'?e.value.slice(e.selectionStart,e.selectionEnd):'';}return String(window.getSelection()??'');})()`);
  if(value.action==='input'){const event=inputEvent(value.event);guest.focus();guest.sendInputEvent(event);return;}
  throw Error('Unsupported browser surface action');
 };
};
module.exports.inputEvent=inputEvent;
