'use strict';
// A remote image belongs inside the original browser panel. The original app
// still owns its tabs, URL bar, permissions, navigation and browser-use tools.
(function(root){
 function point(rect,frame,x,y){
  if(!frame||rect.width<=0||rect.height<=0||frame.width<=0||frame.height<=0)return null;
  const scale=Math.min(rect.width/frame.width,rect.height/frame.height);
  const left=rect.left+(rect.width-frame.width*scale)/2,top=rect.top+(rect.height-frame.height*scale)/2;
  const px=(x-left)/scale,py=(y-top)/scale;
  if(px<0||py<0||px>=frame.width||py>=frame.height)return null;
  return {x:Math.floor(px),y:Math.floor(py)};
 }
 function visible(element){
  if(!element.isConnected||document.hidden||element.closest('[inert],[aria-hidden="true"]'))return false;
  const rect=element.getBoundingClientRect();
  if(rect.width<2||rect.height<2||rect.right<=0||rect.bottom<=0||rect.left>=innerWidth||rect.top>=innerHeight)return false;
  for(let node=element;node&&node!==document;node=node.parentElement){
   const style=getComputedStyle(node);
   if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<0.05)return false;
  }
  return true;
 }
 function prepareLayout(element){
  // Electron supplies a display box for <webview>; an ordinary browser treats
  // it as an empty inline element and ignores its CSS width/height. Establish
  // layout before checking visibility, otherwise the first frame never starts.
  if(getComputedStyle(element).display==='inline')element.style.display='block';
 }
 function create(call,{writeText=()=>{}}={}){
  const views=new Map();let closed=false,timer;
  const routeOf=element=>({conversationId:element.getAttribute('data-browser-sidebar-conversation-id'),browserTabId:element.getAttribute('data-browser-sidebar-browser-tab-id')});
  const sameRoute=(a,b)=>a.conversationId===b.conversationId&&a.browserTabId===b.browserTabId;
  function mount(element){
   const image=document.createElement('img'),status=document.createElement('span'),input=document.createElement('textarea');
   const state={element,image,status,input,frame:null,revision:null,url:null,tail:Promise.resolve(),queued:0,disposed:false,route:routeOf(element),listeners:[]};
   element.style.display='block';element.style.touchAction='none';if(getComputedStyle(element).position==='static')element.style.position='relative';
   image.alt='内置浏览器页面';image.draggable=false;
   image.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none;background:#fff';
   status.textContent='正在连接浏览器画面…';status.setAttribute('role','status');
   status.style.cssText='position:absolute;left:12px;top:12px;font:13px sans-serif;background:Canvas;color:CanvasText;padding:6px;pointer-events:none';
   input.setAttribute('aria-label','内置浏览器输入');input.autocapitalize='off';input.autocomplete='off';input.spellcheck=false;
   input.style.cssText='position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;resize:none';
   element.append(image,status,input);
   const on=(target,name,fn,options)=>{target.addEventListener(name,fn,options);state.listeners.push(()=>target.removeEventListener(name,fn,options));};
   function request(payload){
    if(closed||state.disposed||!visible(element)||!sameRoute(state.route,routeOf(element)))return Promise.resolve();
    if(state.queued>=128){status.textContent='输入繁忙，请稍后重试';status.hidden=false;return Promise.reject(Error('Browser input busy'));}
    state.queued++;
    const route={...state.route};
    const next=state.tail.then(()=>{
     if(closed||state.disposed||!sameRoute(route,routeOf(element))||!visible(element))return;
     return call('browser.surface',route,payload);
    });
    state.tail=next.catch(()=>{status.textContent='浏览器操作失败，请重试';status.hidden=false;}).finally(()=>{state.queued--;});
    return next;
   }
   const mods=e=>['shift','control','alt','meta'].filter((_,i)=>[e.shiftKey,e.ctrlKey,e.altKey,e.metaKey][i]);
   let lastMove=0,pressed=null,lastPoint=null,lastClick=null,clickCount=1;
   function mouse(e,type){
    const coords=point(image.getBoundingClientRect(),state.frame,e.clientX,e.clientY)??(type==='mouseUp'?lastPoint:null);
    if(!coords)return;
    lastPoint=coords;
    e.preventDefault();e.stopPropagation();
    if(type==='mouseDown'){
     input.focus({preventScroll:true});pressed=['left','middle','right'][e.button]??'left';element.setPointerCapture?.(e.pointerId);
     clickCount=lastClick&&Date.now()-lastClick.at<400&&lastClick.button===pressed&&Math.hypot(coords.x-lastClick.x,coords.y-lastClick.y)<5?2:1;
     lastClick=clickCount===2?null:{...coords,button:pressed,at:Date.now()};
    }
    const button=pressed??['left','middle','right'][e.button]??'left';
    void request({action:'input',event:{type,...coords,button,clickCount,modifiers:mods(e)}}).catch(()=>{});
    if(type==='mouseUp'){pressed=null;if(element.hasPointerCapture?.(e.pointerId))element.releasePointerCapture(e.pointerId);}
   }
   on(element,'pointerdown',e=>mouse(e,'mouseDown'));
   on(element,'pointerup',e=>mouse(e,'mouseUp'));
   on(element,'pointercancel',e=>{if(pressed)mouse(e,'mouseUp');});
   on(element,'pointermove',e=>{if(Date.now()-lastMove<60||state.queued>1)return;lastMove=Date.now();mouse(e,'mouseMove');});
   on(element,'contextmenu',e=>e.preventDefault());
   on(element,'wheel',e=>{
    const coords=point(image.getBoundingClientRect(),state.frame,e.clientX,e.clientY);if(!coords)return;
    e.preventDefault();e.stopPropagation();const unit=e.deltaMode===1?16:e.deltaMode===2?state.frame.height:1;
    void request({action:'input',event:{type:'mouseWheel',...coords,deltaX:Math.max(-10000,Math.min(10000,-e.deltaX*unit)),deltaY:Math.max(-10000,Math.min(10000,-e.deltaY*unit)),modifiers:mods(e)}}).catch(()=>{});
   },{passive:false});
   const keyMap={ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Escape:'Escape',Backspace:'Backspace',Delete:'Delete',Enter:'Enter',Tab:'Tab',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',Insert:'Insert'};
   function keyboard(e,type){
    e.stopPropagation();if(e.isComposing||e.key==='Process')return;
    const shortcut=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(shortcut&&key==='v')return; // paste supplies client clipboard text.
    if(shortcut&&(key==='c'||key==='x')){
     e.preventDefault();if(type==='keyDown')void request({action:'selection'}).then(async text=>{
      if(typeof text!=='string'||!text)return;await writeText(text);
      if(key==='x'){await request({action:'input',event:{type:'keyDown',keyCode:'Backspace'}});await request({action:'input',event:{type:'keyUp',keyCode:'Backspace'}});}
     }).catch(()=>{});return;
    }
    const keyCode=keyMap[e.key]??((shortcut||e.altKey)&&/^[ -~]$/.test(e.key)?e.key:undefined);
    if(keyCode){e.preventDefault();void request({action:'input',event:{type,keyCode,modifiers:mods(e)}}).catch(()=>{});}
   }
   on(input,'keydown',e=>keyboard(e,'keyDown'));on(input,'keyup',e=>keyboard(e,'keyUp'));
   on(input,'beforeinput',e=>{e.stopPropagation();if(e.isComposing)return;e.preventDefault();if(e.inputType!=='insertFromComposition'&&e.data)void request({action:'text',text:e.data}).catch(()=>{});});
   on(input,'compositionend',e=>{e.stopPropagation();input.value='';if(e.data)void request({action:'text',text:e.data}).catch(()=>{});});
   on(input,'paste',e=>{e.preventDefault();e.stopPropagation();const text=e.clipboardData?.getData('text/plain');if(text)void request({action:'text',text}).catch(()=>{});});
   state.dispose=()=>{state.disposed=true;for(const off of state.listeners)off();if(state.url)URL.revokeObjectURL(state.url);image.remove();status.remove();input.remove();};
   views.set(element,state);return state;
  }
  async function tick(){
   let changed=false;
   try{
    const elements=Array.from(document.querySelectorAll('webview[data-browser-sidebar-conversation-id][data-browser-sidebar-browser-tab-id]'));
    for(const [element,state] of views)if(!element.isConnected||!sameRoute(state.route,routeOf(element))){state.dispose();views.delete(element);}
    for(const element of elements){
     prepareLayout(element);
     if(closed||!visible(element))continue;
     const state=views.get(element)??mount(element),route={...state.route};
     try{
      const frame=await call('browser.surface',route,{action:'frame',revision:state.revision});
      if(closed||state.disposed||!visible(element)||!sameRoute(route,routeOf(element)))continue;
      if(!(frame?.width>0&&frame.height>0))throw Error('Missing browser dimensions');
      if(frame.bytes){
       const url=URL.createObjectURL(new Blob([frame.bytes],{type:'image/jpeg'}));
       const decoded=document.createElement('img');decoded.src=url;
       try{await decoded.decode();}
       catch(error){URL.revokeObjectURL(url);throw error;}
       if(closed||state.disposed||!visible(element)||!sameRoute(route,routeOf(element))){URL.revokeObjectURL(url);continue;}
       state.image.src=url;if(state.url)URL.revokeObjectURL(state.url);state.url=url;changed=true;
      }
      state.frame={width:frame.width,height:frame.height};state.revision=frame.revision;state.status.hidden=true;
     }catch{if(!state.disposed){state.status.textContent='等待浏览器画面…';state.status.hidden=false;}}
    }
   }finally{if(!closed)timer=setTimeout(tick,changed?250:800);}
  }
  timer=setTimeout(tick,0);
  return {close(){closed=true;clearTimeout(timer);for(const state of views.values())state.dispose();views.clear();}};
 }
 const api={create,point};if(typeof module==='object'&&module.exports)module.exports=api;else root.chatgptWebBrowserView=api;
})(globalThis);
