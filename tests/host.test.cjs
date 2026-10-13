const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const asModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function modules(){
 const rpc=pathToFileURL(path.join(path.dirname(require.resolve('capnweb')),'index.js')).href;
 const adapter=asModule(fs.readFileSync('bridge/rpc-client.mjs','utf8').replace("'./capnweb.js'",JSON.stringify(rpc)));
 const source=fs.readFileSync('bridge/host.mjs','utf8').replace("'./capnweb.js'",JSON.stringify(rpc)).replace("'./rpc-client.mjs'",JSON.stringify(adapter));
 return {...await import(rpc),...await import(adapter),...await import(asModule(source))};
}
const until=async predicate=>{const end=Date.now()+1500;while(!predicate()){if(Date.now()>end)throw Error('Condition timed out');await new Promise(r=>setTimeout(r,5));}};
test('prewarm retains one native service graph across browsers, routes current callbacks and preserves streams',async()=>{
 const {RpcTarget,newMessagePortRpcSession,createWarmHost,adaptAppHost}=await modules();
 const state={reads:0,warmups:0,disposed:0},nativePort=new MessageChannel(),connections=[];
 class Info extends RpcTarget{get(){state.warmups++;return {version:'test'};}[Symbol.dispose](){state.disposed++;}}
 class Startup extends RpcTarget{async whenReady(){}}
 class Fetch extends RpcTarget{async fetch(){return {response:new Response('warm stream')};}cancel(){}}
 class Backend extends RpcTarget{get services(){state.reads++;return {appInfo:new Info(),startup:new Startup(),httpFetch:new Fetch()};}}
 const backend=newMessagePortRpcSession(nativePort.port2,new Backend());
 const warm=createWarmHost(nativePort.port1);
 try{
  await warm.ready;assert.equal(state.reads,1);assert.equal(state.warmups,1);
  const callbacks=await backend.services;
  await callbacks.downloads.stateChanged({count:1});
  await assert.rejects(Promise.resolve(callbacks.appActions.confirm()),/disconnected/);
  for(let n=0;n<3;n++){
   const c=new MessageChannel(),received=[];let confirmed=0;
   class Downloads extends RpcTarget{stateChanged(value){received.push(value);}}
   class Actions extends RpcTarget{confirm(){confirmed++;return 'active browser';}}
   class View extends RpcTarget{get services(){return {downloads:new Downloads(),appActions:new Actions()};}}
   const view=newMessagePortRpcSession(c.port1,new View());connections.push([c,view]);
   const adapter=adaptAppHost(c.port2,{});
   const detach=await warm.attach(adapter.port),services=await view.services;
   await until(()=>received.length===1);assert.equal(received[0].count,n+1);
   assert.equal((await services.appInfo.get()).version,'test');
   const response=await services.httpFetch.fetch('id-'+n,{});assert.equal(await response.response.text(),'warm stream');response[Symbol.dispose]();
   assert.equal(await callbacks.appActions.confirm(),'active browser');assert.equal(confirmed,1);
   await callbacks.downloads.stateChanged({count:n+2});assert.equal(received.length,2);
   detach();services[Symbol.dispose]();adapter.close();view[Symbol.dispose]();c.port1.close();
   assert.equal(state.disposed,0,'browser disposal must retain the native service');
  }
  assert.equal(state.reads,1);callbacks[Symbol.dispose]();
 }finally{
  warm.close();backend[Symbol.dispose]();nativePort.port2.close();
  for(const [c,v] of connections){v[Symbol.dispose]();c.port1.close();c.port2.close();}
 }
});

test('native connection loss is reported instead of advertising stale ready state',async()=>{
 const {RpcTarget,newMessagePortRpcSession,createWarmHost}=await modules();const channel=new MessageChannel();let failure;
 class Startup extends RpcTarget{whenReady(){}}
 class Info extends RpcTarget{get(){return {version:'test'};}}
 const native=newMessagePortRpcSession(channel.port2,{services:{startup:new Startup(),appInfo:new Info()}});
 const warm=createWarmHost(channel.port1,{onBroken:error=>{failure=error;}});
 try{await warm.ready;native[Symbol.dispose]();await until(()=>failure);assert.match(failure.message,/closed/i);}
 finally{warm.close();native[Symbol.dispose]();channel.port2.close();}
});
