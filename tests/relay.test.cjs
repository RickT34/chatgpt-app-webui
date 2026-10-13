const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const codec=require('../bridge/codec.js');
test('forward synthetic preload responses with null source; reject other windows',()=>{
 const listeners=new Map(),sent=[];
 const window={electronBridge:{subscribeToSystemThemeVariant:()=>{}},chatgptWebCodec:codec,
  chatgptWebTransport:{send:data=>sent.push(codec.unpack(data)),subscribe:()=>{},getSnapshot:()=>({})},
  addEventListener:(name,callback)=>listeners.set(name,callback)};
 new Function('window','('+fs.readFileSync('bridge/relay.js','utf8')+')()')(window);
 sent.length=0;
 const data={type:'shared-object-updated',key:'loading-state',value:'ready'};
 listeners.get('message')({source:null,data});
 assert.deepEqual(sent,[{kind:'event',value:data}]);
 listeners.get('message')({source:{},data});
 assert.equal(sent.length,1);
 listeners.get('message')({source:window,data:{type:'connect-app-host'}});
 assert.equal(sent.length,1);
});

test('unsubscribe releases worker listeners; disconnect closes ports and minimal-host subscriptions',async()=>{
 for(const minimal of [true,false]){
  let receive,stopped=0,closed=0;const calls=[],acks=[];
  const window={document:{documentElement:{dataset:{chatgptWebHost:minimal?'minimal':undefined}}},
   electronBridge:{subscribeToSystemThemeVariant(){},subscribeToWorkerMessages(){return()=>stopped++;},
    sendMessageFromView:async value=>{calls.push(value);},acknowledgeChunkedMessage:(...args)=>acks.push(args)},
   chatgptWebCodec:codec,chatgptWebTransport:{send(){},subscribe:fn=>{receive=fn;},getSnapshot:()=>({})},
   addEventListener(){},postMessage(){},location:{origin:'app://-'}};
  class Channel{constructor(){this.port1={close(){closed++;}};this.port2={};}}
  await new Function('window','MessageChannel','createHost','return ('+fs.readFileSync('bridge/relay.js','utf8')+')(createHost)')(window,Channel,()=>({ready:Promise.resolve(),attach:async()=>()=>{}}));
  const send=message=>receive(codec.pack(message));
  await send({kind:'worker-subscribe',id:'one'});await send({kind:'worker-subscribe',id:'one'});
  await send({kind:'worker-unsubscribe',id:'one'});await send({kind:'worker-unsubscribe',id:'one'});assert.equal(stopped,1);
  await send({kind:'worker-subscribe',id:'one'});
  await send({kind:'port-open',id:1});
  await send({kind:'call',method:'sendMessageFromView',args:[{type:'shared-object-subscribe',key:'state'}],id:2});
  await send({kind:'ack-discarded-chunk',transferId:'chunk',sequence:3});
  assert.deepEqual(acks,minimal?[['chunk',3]]:[]);
  await send({kind:'disconnect'});await send({kind:'disconnect'});
  assert.equal(stopped,2);assert.equal(closed,1);
  assert.equal(calls.filter(value=>value.type==='shared-object-unsubscribe').length,minimal?1:0);
 }
});
