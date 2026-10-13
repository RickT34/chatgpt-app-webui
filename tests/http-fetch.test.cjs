'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const codec=require('../bridge/codec.js');
const timeout=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Test deadline exceeded')),2000);})]);}finally{clearTimeout(timer);}};
async function until(predicate){const end=Date.now()+1500;while(!predicate()){if(Date.now()>end)throw Error('Condition deadline exceeded');await new Promise(resolve=>setTimeout(resolve,5));}}
async function fixture(fetcher,run){
 const moduleUrl=pathToFileURL(path.join(path.dirname(require.resolve('capnweb')),'index.js')).href;
 const {RpcTarget,newMessagePortRpcSession}=await import(moduleUrl);
 const source=fs.readFileSync('bridge/rpc-client.mjs','utf8').replace("'./capnweb.js'",JSON.stringify(moduleUrl));
 const {adaptAppHost}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const state={calls:[],cancels:[],disposed:0};
 class HttpFetch extends RpcTarget{
  fetch(...args){state.calls.push(args[0]);return fetcher(state,...args);}
  cancel(id){state.cancels.push(id);return state.onCancel?.(id);}
  [Symbol.dispose](){state.disposed++;}
 }
 const a=new MessageChannel(),b=new MessageChannel();
 const client=newMessagePortRpcSession(a.port1,{services:{}});
 const adapter=adaptAppHost(a.port2,{});
 const host=newMessagePortRpcSession(b.port1,{services:{httpFetch:new HttpFetch()}});
 const wire=value=>codec.unpack(codec.pack({value})).value;
 adapter.port.onmessage=e=>b.port2.postMessage(wire(e.data));b.port2.onmessage=e=>adapter.port.postMessage(wire(e.data));
 try{await run((await timeout(client.services)).httpFetch,state,adapter,()=>host[Symbol.dispose]());}
 finally{adapter.close();client[Symbol.dispose]();host[Symbol.dispose]();for(const p of [a.port1,a.port2,b.port1,b.port2])p.close();}
}

test('HTTP Response crosses both RPC sessions and JSON codec without buffering the body',()=>fixture(async(state,id,request,progress)=>{
 assert.equal(request.method,'POST');assert.deepEqual(request.body,new Uint8Array([1,2,3]));
 await progress(3);
 return {response:new Response(new ReadableStream({start(controller){state.body=controller;controller.enqueue(new TextEncoder().encode('first'));}}),{status:206,statusText:'Partial Content',headers:{'content-type':'text/plain','x-test':'preserved'}})};
},async(httpFetch,state)=>{
 let uploaded=0;
 const result=await timeout(httpFetch.fetch('stream',{method:'POST',body:new Uint8Array([1,2,3])},n=>{uploaded=n;}));
 assert.equal(uploaded,3);assert.equal(result.response.status,206);assert.equal(result.response.statusText,'Partial Content');assert.equal(result.response.headers.get('x-test'),'preserved');
 const reader=result.response.body.getReader();
 assert.equal(new TextDecoder().decode((await timeout(reader.read())).value),'first');
 state.body.enqueue(new TextEncoder().encode('second'));state.body.close();
 assert.equal(new TextDecoder().decode((await timeout(reader.read())).value),'second');assert((await timeout(reader.read())).done);
 reader.releaseLock();result[Symbol.dispose]();
 await httpFetch.cancel('stream');assert.deepEqual(state.cancels,['stream']);
}));

test('empty responses, error envelopes and exceptions preserve their meaning',()=>fixture(async(_state,id)=>{
 if(id==='empty')return {response:new Response(null,{status:204,headers:{'x-empty':'yes'}})};
 if(id==='error')return {error:'Access denied',status:403,errorCode:'denied',responseStatus:403};
 throw Error('upstream unavailable');
},async(httpFetch)=>{
 const empty=await timeout(httpFetch.fetch('empty',{}));assert.equal(empty.response.status,204);assert.equal(empty.response.body,null);assert.equal(empty.response.headers.get('x-empty'),'yes');empty[Symbol.dispose]();
 const error=await timeout(httpFetch.fetch('error',{}));assert.equal(error.status,403);assert.equal(error.errorCode,'denied');error[Symbol.dispose]();
 await assert.rejects(timeout(httpFetch.fetch('throw',{})),/upstream unavailable/);
}));

test('cancel before response headers rejects the caller and releases a late response',()=>fixture((state)=>new Promise(resolve=>{state.reply=resolve;}),async(httpFetch,state)=>{
 const request=Promise.resolve(httpFetch.fetch('pending',{}));request.catch(()=>{});
 await until(()=>state.reply);
 await timeout(httpFetch.cancel('pending'));
 await assert.rejects(timeout(request),/canceled|disposed|abort/i);
 let canceled=false;
 state.reply({response:new Response(new ReadableStream({cancel(){canceled=true;}}))});
 await until(()=>canceled);assert.deepEqual(state.cancels,['pending']);
}));

test('App body cancellation forwards its cancel RPC; stream errors reject reads',()=>fixture(async(state,id)=>({response:new Response(new ReadableStream({start(controller){state[id]=controller;},cancel(){state.bodyCanceled=true;}}))}),async(httpFetch,state)=>{
 const first=await timeout(httpFetch.fetch('cancel-body',{}));
 // Match the original App's Cxn wrapper: pipe completion/cancellation calls
 // httpFetch.cancel and disposes the result. A raw capnweb stream alone does
 // not immediately notify an idle producer that has no pending writes.
 const channel=new TransformStream();
 const finished=first.response.body.pipeTo(channel.writable).catch(()=>{}).finally(async()=>{await httpFetch.cancel('cancel-body');first[Symbol.dispose]();});
 await channel.readable.cancel();await timeout(finished);assert(state.cancels.includes('cancel-body'));
 const broken=await timeout(httpFetch.fetch('broken',{}));const read=broken.response.text();state.broken.error(Error('body failed'));
 await assert.rejects(timeout(read),/body failed/);broken[Symbol.dispose]();
}));

test('explicit cancellation and adapter close release active requests',()=>fixture(async(state,id)=>({response:new Response(new ReadableStream({start(controller){state[id]=controller;},cancel(){state.canceledBodies=(state.canceledBodies||0)+1;}}))}),async(httpFetch,state,adapter,closeRemote)=>{
 const first=await timeout(httpFetch.fetch('cancel',{}));const read=first.response.text();read.catch(()=>{});
 await timeout(httpFetch.cancel('cancel'));await assert.rejects(timeout(read),/cancel|abort/i);first[Symbol.dispose]();
 const second=await timeout(httpFetch.fetch('disconnect',{}));const pending=second.response.text();pending.catch(()=>{});
 adapter.close();await assert.rejects(timeout(pending));second[Symbol.dispose]();
 // The real WebSocket close handler also closes the host-side RPC port.
 closeRemote();await until(()=>state.disposed===1);
 assert.equal(state.cancels.filter(id=>id==='cancel').length,1);
}));

test('canceling one concurrent fetch does not interrupt another response',()=>fixture(async(state,id)=>({response:new Response(new ReadableStream({start(controller){state[id]=controller;controller.enqueue(new TextEncoder().encode(id));}}))}),async(httpFetch,state)=>{
 const [one,two]=await timeout(Promise.all([httpFetch.fetch('one',{}),httpFetch.fetch('two',{})]));
 const canceled=one.response.text();canceled.catch(()=>{});
 await timeout(httpFetch.cancel('one'));await assert.rejects(timeout(canceled),/cancel|abort/i);
 state.two.close();assert.equal(await timeout(two.response.text()),'two');
 one[Symbol.dispose]();two[Symbol.dispose]();assert.deepEqual(state.cancels,['one']);
}));
