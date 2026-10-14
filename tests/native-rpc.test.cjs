const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('clipboard is local, failures propagate, other services and callbacks cross both sessions',async()=>{
 const moduleUrl=pathToFileURL(path.join(path.dirname(require.resolve('capnweb')),'index.js')).href;
 const {RpcTarget,newMessagePortRpcSession}=await import(moduleUrl);
 const source=fs.readFileSync('bridge/rpc-client.mjs','utf8').replace("'./capnweb.js'",JSON.stringify(moduleUrl));
 const {adaptAppHost}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const a=new MessageChannel(),b=new MessageChannel();let localText='',hostWrites=0,callback='',startupCalls=0,serviceReads=0;const hostPhases=[],clientPhases=[];
 class LocalCallback extends RpcTarget{notify(value){callback=value;}}
 class OriginalView extends RpcTarget{get services(){return {callback:new LocalCallback()};}}
 class HostClipboard extends RpcTarget{writeText(){hostWrites++;}}
 class Info extends RpcTarget{get(){return 'original app';}}
 class Startup extends RpcTarget{whenReady(){startupCalls++;return new Promise(()=>{});}isSentryEnabled(){throw Error('Browser must not enable the Electron-only Sentry transport');}reach(phase){hostPhases.push(phase);}}
 class OriginalHost extends RpcTarget{get services(){serviceReads++;return {clipboard:new HostClipboard(),appInfo:new Info(),startup:new Startup()};}}
 const view=newMessagePortRpcSession(a.port1,new OriginalView());
 const adapter=adaptAppHost(a.port2,{writeText:async value=>{if(value==='denied')throw Error('denied by browser');localText=value;},readText:async()=>localText},{onPhase:phase=>clientPhases.push(phase)});
 const host=newMessagePortRpcSession(b.port1,new OriginalHost());
 adapter.port.onmessage=e=>b.port2.postMessage(e.data);b.port2.onmessage=e=>adapter.port.postMessage(e.data);
 try{
  const readiness=adapter.ready();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(serviceReads,0,'watcher must not request services ahead of the frontend');
  const services=await view.services;
  await Promise.race([readiness,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Handshake did not finish')),1000);timer.unref();})]);
  await services.startup.whenReady();
  assert.equal(await services.startup.isSentryEnabled(),false);
  await services.startup.reach('renderer_ready');
  await services.startup.reach('first_content_visible');
  assert.deepEqual(clientPhases,['renderer_ready','first_content_visible']);assert.deepEqual(hostPhases,clientPhases);
  assert.equal(serviceReads,1);assert.equal(startupCalls,0,'watcher must not wait for native window readiness');
  await services.clipboard.writeText('client text');assert.equal(localText,'client text');assert.equal(hostWrites,0);
  assert.equal(await services.clipboard.readText(),'client text');
  await assert.rejects(Promise.resolve(services.clipboard.writeText('denied')),/denied by browser/);
  assert.equal(await services.appInfo.get(),'original app');
  const callbacks=await host.services;await callbacks.callback.notify('round trip');assert.equal(callback,'round trip');
 }finally{view[Symbol.dispose]();host[Symbol.dispose]();adapter.close();a.port1.close();b.port1.close();b.port2.close();}
});
