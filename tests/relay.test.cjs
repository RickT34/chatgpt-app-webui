const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const codec=require('../bridge/codec.js');
test('a new browser bootstrap reads current native sidebar and shared state',async()=>{
 let receive,revision=1;const sent=[];
 const window={electronBridge:{subscribeToSystemThemeVariant(){},getInitialSidebarBootstrap:()=>({catalogEntries:[1]})},
  chatgptWebCodec:codec,chatgptWebTransport:{send:data=>sent.push(codec.unpack(data)),subscribe:fn=>{receive=fn;},getSnapshot:()=>({revision}),getInitialSidebarBootstrap:()=>({catalogEntries:[revision]})},
  addEventListener(){}};
 await new Function('window','return ('+fs.readFileSync('bridge/relay.js','utf8')+')()')(window);
 assert.equal(sent[0].value.shared.revision,1);
 revision=2;await receive(codec.pack({kind:'bootstrap-refresh',id:7}));
 assert.equal(sent.at(-1).kind,'bootstrap-fresh');assert.equal(sent.at(-1).id,7);
 assert.deepEqual(sent.at(-1).value.getInitialSidebarBootstrap,{catalogEntries:[2]});assert.equal(sent.at(-1).value.shared.revision,2);
});
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

test('late results and port responses retain the old session after a replacement connects',async()=>{
 let receive,finish;const sent=[],channels=[];
 const window={electronBridge:{subscribeToSystemThemeVariant(){},sendMessageFromView:()=>new Promise(resolve=>{finish=resolve;})},
  chatgptWebCodec:codec,chatgptWebTransport:{send:data=>sent.push(codec.unpack(data)),subscribe:fn=>{receive=fn;},getSnapshot:()=>({})},
  addEventListener(){},postMessage(){},location:{origin:'app://-'}};
 class Channel{constructor(){this.port1={close(){}};this.port2={};channels.push(this);}}
 await new Function('window','MessageChannel','return ('+fs.readFileSync('bridge/relay.js','utf8')+')()')(window,Channel);
 const pending=receive(codec.pack({kind:'call',id:1,session:'old',method:'sendMessageFromView',args:[{}]}));
 await receive(codec.pack({kind:'port-open',id:2,session:'old'}));const latePort=channels[0].port1.onmessage;
 await receive(codec.pack({kind:'disconnect'}));await receive(codec.pack({kind:'port-open',id:2,session:'new'}));
 finish('old result');await pending;latePort({data:'old port data'});
 assert.equal(sent.find(m=>m.kind==='result').session,'old');assert.equal(sent.at(-1).session,'old');
 channels[1].port1.onmessage({data:'new port data'});assert.equal(sent.at(-1).session,'new');
});

test('agent capture geometry stays native while the web panel retains its visible layout',async()=>{
 for(const minimal of [true,false]){
  const listeners=new Map(),sent=[];
  const window={document:{documentElement:{dataset:{chatgptWebHost:minimal?'minimal':undefined}}},
   electronBridge:{subscribeToSystemThemeVariant(){}},chatgptWebCodec:codec,
   chatgptWebTransport:{send:data=>sent.push(codec.unpack(data)),subscribe(){},getSnapshot:()=>({})},
   addEventListener:(type,fn)=>listeners.set(type,fn),postMessage(){},location:{origin:'app://-'}};
  class Channel{constructor(){this.port1={};this.port2={};}}
  await new Function('window','MessageChannel','createHost','return ('+fs.readFileSync('bridge/relay.js','utf8')+')(createHost)')(window,Channel,()=>({ready:Promise.resolve()}));
  const route={conversationId:'thread',browserTabId:'tab'};
  const original={type:'browser-sidebar-browser-use-capture-surface',...route,surfaceSize:{width:1800,height:1200}};
  listeners.get('message')({source:null,data:original});
  assert.deepEqual(sent.at(-1).value,{...original,surfaceSize:minimal?null:original.surfaceSize});
  assert.deepEqual(original.surfaceSize,{width:1800,height:1200},'do not mutate the native event');
  const activity={type:'browser-sidebar-browser-use-state',...route,isActive:true};
  listeners.get('message')({source:null,data:activity});
  assert.deepEqual(sent.at(-1).value,activity,'agent activity must still reach the original UI');
  const released={...original,surfaceSize:null};
  listeners.get('message')({source:null,data:released});
  assert.deepEqual(sent.at(-1).value,released);
 }
});
