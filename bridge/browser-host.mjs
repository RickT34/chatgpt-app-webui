// The web UI's <webview> is an inert HTML element. Keep the actual Electron
// guests in the resident renderer, using the original browserHost admission,
// persistence, preload and permission handlers.
export function createBrowserHost(service,{document,sendMessage,report=console.warn,sessionId=crypto.randomUUID()}={}){
 const pages=new Map(),pendingSizes=new Map();let generation=0,session=null,closed=false;
 const key=route=>JSON.stringify([route.conversationId,route.browserTabId]);
 const valid=route=>typeof route?.conversationId==='string'&&route.conversationId.length>0&&typeof route.browserTabId==='string'&&route.browserTabId.length>0;
 const start=()=>session??=(async()=>{
  try{if(!await service.registerWebviewHostSession({rendererInstanceId:sessionId}))throw Error('Browser host session rejected');return true;}
  catch(error){session=null;throw error;}
 })();
 function size(value,fallback={width:1280,height:720}){
  return value&&[value.width,value.height].every(n=>Number.isFinite(n)&&n>0&&n<=8192)
   ?{width:Math.round(value.width),height:Math.round(value.height)}:fallback;
 }
 function resize(page){
  const bounds=size(page.capture??page.viewport??page.bounds);
  Object.assign(page.element.style,{width:bounds.width+'px',height:bounds.height+'px'});
 }
 function remove(page){
  if(pages.get(page.key)!==page)return;
  pages.delete(page.key);page.removed=true;page.element?.remove();page.element?.destroy?.();
 }
 async function register(route){
  if(closed||!valid(route))return false;
  const id=key(route);let page=pages.get(id);
  if(page){
   await page.ready;
   if(page.removed)return false;
   // Reconnects reuse the guest, but must still let the official persistence
   // service reject a stale or incompatible restore request.
   if(route.pagePersistence){
    const accepted=await service.registerWebviewHost({...page.route,pagePersistence:route.pagePersistence,hostGeneration:page.generation,rendererInstanceId:sessionId});
    if(!accepted||page.removed)return false;
    page.element.setAttribute('data-browser-sidebar-page-restore',route.pagePersistence.restore);
    page.element.setAttribute('data-browser-sidebar-page-storage-id',route.pagePersistence.browserStorageId);
   }
   return true;
  }
  page={...pendingSizes.get(id),key:id,route:{conversationId:route.conversationId,browserTabId:route.browserTabId},generation:++generation,removed:false,element:null};
  pendingSizes.delete(id);
  pages.set(id,page);
  page.ready=(async()=>{
   await start();
   if(page.removed||closed)return false;
   const accepted=await service.registerWebviewHost({...page.route,pagePersistence:route.pagePersistence,hostGeneration:page.generation,rendererInstanceId:sessionId});
   if(!accepted||page.removed||closed){remove(page);return false;}
   const element=document.createElement('webview');page.element=element;
   element.setAttribute('data-browser-sidebar-conversation-id',route.conversationId);
   element.setAttribute('data-browser-sidebar-browser-tab-id',route.browserTabId);
   element.setAttribute('partition',`persist:codex-browser-app-route:${encodeURIComponent(route.conversationId+'\0'+route.browserTabId)}:host:${sessionId}:${page.generation}`);
   if(route.pagePersistence){
    element.setAttribute('data-browser-sidebar-page-restore',route.pagePersistence.restore);
    element.setAttribute('data-browser-sidebar-page-storage-id',route.pagePersistence.browserStorageId);
   }
   element.setAttribute('webviewrole','tab');element.setAttribute('src','about:blank');
   // Keep an actual layout/capture surface even for background tool requests.
   // Do not use display:none, which leaves Chromium with a zero-size viewport.
   Object.assign(element.style,{display:'flex',position:'absolute',left:'0',top:'0'});resize(page);
   element.addEventListener('destroyed',()=>remove(page));
   document.body.append(element);
   return true;
  })().catch(error=>{remove(page);throw error;});
  return page.ready;
 }
 async function syncView(request){
  const page=pages.get(key(request));
  if(page){await page.ready;if(page.removed)return;observeViewMessage({type:'browser-sidebar-sync',payload:request});}
  return service.syncView(request);
 }
 function observeViewMessage(message){
  if(message?.type!=='browser-sidebar-sync'||!valid(message.payload))return;
  const page=pages.get(key(message.payload));
  if(!page)return;
  const {bounds,mountGeneration=0,visible=false}=message.payload;
  Object.assign(page,{bounds,mountGeneration,visible});
  if(page.element)resize(page);
 }
 function handle(message){
  if(closed||!valid(message))return;
  const page=pages.get(key(message));
  switch(message.type){
   case 'browser-sidebar-browser-use-state':
    if(message.isActive&&!page)void register(message).catch(error=>report('[browser-host] '+error.message));
    break;
   case 'browser-sidebar-browser-use-viewport':
   case 'browser-sidebar-browser-use-capture-surface': {
    // The original manager sends its initial viewport before the active event.
    const id=key(message),state=page??pendingSizes.get(id)??{};
    if(message.type.endsWith('-viewport'))state.viewport=message.viewportSize;
    else state.capture=message.surfaceSize;
    if(page?.element)resize(page);
    if(!page){pendingSizes.set(id,state);if(pendingSizes.size>128)pendingSizes.delete(pendingSizes.keys().next().value);}
    break;
   }
   case 'browser-sidebar-destroy-webview':
    pendingSizes.delete(key(message));
    if(page&&(message.reason==='closed'||(!page.visible&&(page.mountGeneration??0)===message.mountGeneration)))remove(page);
    void Promise.resolve(sendMessage({type:'browser-sidebar-webview-destroyed',...{conversationId:message.conversationId,browserTabId:message.browserTabId,reason:message.reason,teardownId:message.teardownId}})).catch(error=>report('[browser-host] '+error.message));
    break;
   case 'close-browser-tab':pendingSizes.delete(key(message));if(page)remove(page);break;
  }
 }
 return {registerWebviewHostSession:start,registerWebviewHost:register,syncView,handle,observeViewMessage,
  close(){closed=true;pendingSizes.clear();for(const page of pages.values())remove(page);}};
}
