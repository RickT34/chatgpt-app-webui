import {newMessagePortRpcSession,RpcTarget,RpcStub} from './capnweb.js';
export class HttpFetch extends RpcTarget {
 constructor(native){super();this.native=native.dup();this.requests=new Map();}
 async fetch(id,request,onUploadProgress){
  if(!this.native)throw Error('App HTTP connection closed');
  if(this.requests.has(id))throw Error('HTTP request already active');
  const call=this.native.fetch(id,request,onUploadProgress);
  let result,reader,controller,rejectCanceled,released=false;
  const canceled=new Promise((_,reject)=>{rejectCanceled=reject;});
  const release=()=>{
   if(released)return;released=true;this.requests.delete(id);
   reader?.releaseLock();result?.[Symbol.dispose]?.();call[Symbol.dispose]();
  };
  const state={close:reason=>{
   if(released)return;
   rejectCanceled(reason);controller?.error(reason);
   if(reader)void reader.cancel(reason).catch(()=>{});
   release();
  }};
  this.requests.set(id,state);
  try{
   result=await Promise.race([call,canceled]);
   // A service stub cannot transparently forward an owned Response/stream
   // through a second capnweb session. Re-export a locally owned stream, and
   // retain the upstream result until EOF, cancellation, error or disconnect.
   if(!result.response?.body){const value={...result};release();return value;}
   const response=result.response;reader=response.body.getReader();
   const body=new ReadableStream({
    start(value){controller=value;},
    async pull(value){
     try{const chunk=await reader.read();if(chunk.done){value.close();release();}else value.enqueue(chunk.value);}
     catch(error){if(!released){value.error(error);release();}}
    },
    async cancel(reason){try{await reader.cancel(reason);}finally{release();}}
   },{highWaterMark:0});
   return {...result,response:new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers})};
  }catch(error){release();throw error;}
 }
 async cancel(id){
  if(!this.native)return;
  const call=this.native.cancel(id);
  this.requests.get(id)?.close(new DOMException('HTTP request canceled','AbortError'));
  try{return await call;}finally{call[Symbol.dispose]();}
 }
 [Symbol.dispose](){
  if(!this.native)return;
  for(const id of this.requests.keys())void this.cancel(id).catch(()=>{});
  this.native[Symbol.dispose]();this.native=null;
 }
}
// Two RPC sessions preserve callbacks and service references while adapting
// desktop clipboard and window startup services. No dependency on private export-table IDs.
export function adaptAppHost(uiPort,clipboard,{onPhase=()=>{}}={}){
 const network=new MessageChannel();let ui;
 class Clipboard extends RpcTarget {
  writeText(text){return clipboard.writeText(text);}
  readText(){return clipboard.readText();}
  get bookmark(){return undefined;}
 }
 // The browser has its own window lifecycle. Native whenReady() is gated by
 // the hidden desktop window's startup critical path, not this RPC connection.
 class Startup extends RpcTarget {
  constructor(native){super();this.native=native.dup();}
  async whenReady(){return undefined;}
  // The Electron SDK sends scope updates through sentry-ipc://. A browser has
  // no such transport; enabling it creates a failed request for every update.
  // Native host reporting keeps its own startup service and remains untouched.
  async isSentryEnabled(){return false;}
  async reach(phase){onPhase(phase);return this.native.reach(phase);}
  [Symbol.dispose](){this.native[Symbol.dispose]();}
 }
 class View extends RpcTarget {get services(){return ui.services;}}
 const host=newMessagePortRpcSession(network.port1,new View());
 let services,httpFetch,resolveReady,rejectReady;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 // Observe the UI's existing request. Do not initiate another services request or
 // call startup.whenReady(), which belongs to the original frontend lifecycle.
 ready.catch(()=>{});
 class Host extends RpcTarget {
  get services(){return services??=new RpcStub(async()=>{
   try{const value=await host.services;resolveReady();return {...value,clipboard:new Clipboard(),...(value.startup?{startup:new Startup(value.startup)}:{}),...(value.httpFetch?{httpFetch:httpFetch=new HttpFetch(value.httpFetch)}:{})};}
   catch(error){rejectReady(error);throw error;}
  })();}
 }
 ui=newMessagePortRpcSession(uiPort,new Host());
 return {port:network.port2,ready(){return ready;},close(){rejectReady(Error('App service connection closed'));httpFetch?.[Symbol.dispose]();ui[Symbol.dispose]();host[Symbol.dispose]();network.port1.close();network.port2.close();uiPort.close();}};
}
