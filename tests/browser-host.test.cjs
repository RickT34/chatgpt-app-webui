const {test}=require('node:test');
const assert=require('node:assert/strict');
const route={conversationId:'thread',browserTabId:'tab'};
async function fixture({admit=async()=>true}={}){
 const {createBrowserHost}=await import('../bridge/browser-host.mjs');
 const elements=[],calls=[],messages=[];
 const document={body:{append(element){elements.push(element);}},createElement(tag){
  assert.equal(tag,'webview');return {attrs:{},style:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){},
   remove(){const i=elements.indexOf(this);if(i>=0)elements.splice(i,1);}};
 }};
 const service={async registerWebviewHostSession(value){calls.push(['session',value]);return true;},
  async registerWebviewHost(value){calls.push(['register',value]);return admit(value);},async syncView(value){calls.push(['sync',value]);}};
 const host=createBrowserHost(service,{document,sessionId:'resident',sendMessage:value=>messages.push(value),report:error=>{throw Error(error);}});
 return {host,elements,calls,messages};
}
test('concurrent registration and new browser sessions retain one admitted native guest',async()=>{
 const {host,elements,calls}=await fixture();
 try{
  const results=await Promise.all([host.registerWebviewHost(route),host.registerWebviewHost(route)]);
  assert.deepEqual(results,[true,true]);
  const original=elements[0];
  await host.registerWebviewHostSession({rendererInstanceId:'new-web-browser'});
  await host.registerWebviewHost({...route,hostGeneration:77,rendererInstanceId:'new-web-browser'});
  assert.deepEqual(elements,[original]);
  assert.equal(calls.filter(c=>c[0]==='session').length,1);
  assert.equal(original.attrs.partition,'persist:codex-browser-app-route:thread%00tab:host:resident:1');
  assert.equal(original.attrs.src,'about:blank','the original native service controls navigation');
  assert.equal(original.style.width,'1280px');assert.equal(original.style.height,'720px');
 }finally{host.close();}
});
test('official admission failure creates no guest and permits a later retry',async()=>{
 let allowed=false;const {host,elements}=await fixture({admit:async()=>allowed});
 try{
  assert.equal(await host.registerWebviewHost(route),false);assert.deepEqual(elements,[]);
  allowed=true;assert.equal(await host.registerWebviewHost(route),true);assert.equal(elements.length,1);
 }finally{host.close();}
});
test('teardown during pending registration cannot resurrect a closed tab',async()=>{
 let accept;const {host,elements,messages}=await fixture({admit:()=>new Promise(resolve=>{accept=resolve;})});
 const pending=host.registerWebviewHost(route);
 await host.registerWebviewHostSession();
 host.handle({type:'browser-sidebar-destroy-webview',...route,reason:'closed',teardownId:'teardown'});
 accept(true);
 assert.equal(await pending,false);assert.deepEqual(elements,[]);
 assert.deepEqual(messages,[{type:'browser-sidebar-webview-destroyed',...route,reason:'closed',teardownId:'teardown'}]);
 host.close();
});
test('background browser-use requests create guests without a connected web UI',async()=>{
 const {host,elements}=await fixture();
 try{
  host.handle({type:'browser-sidebar-browser-use-viewport',...route,viewportSize:{width:900,height:600}});
  host.handle({type:'browser-sidebar-browser-use-state',...route,isActive:true});
  await host.registerWebviewHost(route);
  assert.equal(elements.length,1);assert.equal(elements[0].style.width,'900px');
  host.handle({type:'browser-sidebar-browser-use-capture-surface',...route,surfaceSize:{width:1800,height:1200}});
  await host.syncView({...route,bounds:{width:300,height:200}});
  assert.equal(elements[0].style.width,'1800px');assert.equal(elements[0].style.height,'1200px');
  host.handle({type:'close-browser-tab',...route});assert.deepEqual(elements,[]);
 }finally{host.close();}
});
test('reconnect cannot bypass the original persistence admission',async()=>{
 const {host,elements,calls}=await fixture({admit:async value=>value.pagePersistence?.restore!=='required'});
 try{
  await host.registerWebviewHost(route);const original=elements[0];
  const accepted=await host.registerWebviewHost({...route,pagePersistence:{browserStorageId:'missing',restore:'required'}});
  assert.equal(accepted,false);assert.deepEqual(elements,[original]);
  assert.equal(calls.at(-1)[1].pagePersistence.browserStorageId,'missing');
 }finally{host.close();}
});
test('controller shutdown removes all guests and rejects late registrations',async()=>{
 const {host,elements}=await fixture();await host.registerWebviewHost(route);
 host.close();host.close();assert.deepEqual(elements,[]);
 assert.equal(await host.registerWebviewHost(route),false);
});
test('late background teardown does not remove a newly presented page',async()=>{
 const {host,elements,messages}=await fixture();
 try{
  await host.registerWebviewHost(route);
  host.observeViewMessage({type:'browser-sidebar-sync',payload:{...route,mountGeneration:2,visible:true,bounds:{width:800,height:600}}});
  host.handle({type:'browser-sidebar-destroy-webview',...route,reason:'suspended',mountGeneration:1,teardownId:'old'});
  assert.equal(elements.length,1);assert.equal(elements[0].style.width,'800px');
  assert.equal(messages[0].teardownId,'old');
 }finally{host.close();}
});

test('surface requests use the registered native guest, never a client-supplied guest id',async()=>{
 const {host,elements}=await fixture();
 try{
  await host.registerWebviewHost(route);
  Object.assign(elements[0],{getWebContentsId:()=>42,clientWidth:1280,clientHeight:720});
  const forwarded=[];
  const frame=await host.surface(route,{action:'frame',guestId:99,session:'current'},async value=>{forwarded.push(value);return {revision:'image'};});
  assert.deepEqual(forwarded,[{action:'frame',guestId:42,session:'current'}]);
  assert.deepEqual(frame,{revision:'image',width:1280,height:720});
  await assert.rejects(host.surface({...route,browserTabId:'missing'},{action:'frame'},()=>assert.fail('must not forward')),/not attached/);
 }finally{host.close();}
});
test('closing a page during capture discards its late image',async()=>{
 const {host,elements}=await fixture();await host.registerWebviewHost(route);
 Object.assign(elements[0],{getWebContentsId:()=>42});
 let finish;
 const pending=host.surface(route,{action:'frame'},()=>new Promise(resolve=>{finish=resolve;}));
 await Promise.resolve();host.close();finish({bytes:new Uint8Array([1,2,3])});
 await assert.rejects(pending,/closed/);
});
