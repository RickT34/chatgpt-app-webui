'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {bootstrap,connect,wait}=require('../bridge/startup.js');
const {heartbeat,watchRenderer}=require('../bridge/lifecycle.cjs');
test('bootstrap has a deadline even if fetch ignores abort, and does not retry expired authentication',async()=>{
 let signal;
 await assert.rejects(bootstrap((_url,options)=>{signal=options.signal;return new Promise(()=>{});},{timeout:30,requestTimeout:10}),/超时/);
 assert(signal.aborted);
 let calls=0;
 await assert.rejects(bootstrap(async()=>{calls++;return {status:401};}),/登录已过期/);assert.equal(calls,1);
 await assert.rejects(bootstrap(async()=>({status:503}),{timeout:20,retry:2}),/未就绪/);
 await assert.rejects(bootstrap(async()=>({ok:true,json:()=>new Promise(()=>{})}),{timeout:10}),/超时/);
});
test('bootstrap retries not-ready responses and returns a completed snapshot',async()=>{
 let calls=0;
 const value=await bootstrap(async()=>++calls===1?{status:503}:{ok:true,json:async()=>({shared:{}})},{retry:1});
 assert.deepEqual(value,{shared:{}});assert.equal(calls,2);
 await assert.rejects(bootstrap(async()=>({status:500})),/500/);
});
class Socket extends EventTarget{close(){this.closed=true;this.dispatchEvent(new Event('close'));}}
test('WebSocket opening timeout and early close reject; listeners are removed on success',async()=>{
 const stalled=new Socket();await assert.rejects(connect(stalled,10),/超时/);assert(stalled.closed);
 const closing=new Socket(),closed=connect(closing);closing.close();await assert.rejects(closed,/连接失败/);
 const socket=new Socket(),ready=connect(socket);socket.dispatchEvent(new Event('open'));assert.equal(await ready,socket);socket.close();
 await assert.rejects(wait(new Promise(()=>{}),10,'App handshake timeout'),/handshake timeout/);
});
test('heartbeat clears stalled connections and accepts pongs; close stops further checks',()=>{
 let now=0;const ws=new EventEmitter();ws.readyState=1;ws.ping=()=>{ws.pings=(ws.pings||0)+1;};ws.terminate=()=>{ws.dead=true;ws.emit('close');};
 const tick=heartbeat(ws,{interval:100000,timeout:45,now:()=>now});
 now=30;tick();assert.equal(ws.pings,1);ws.emit('pong');now=60;tick();assert(!ws.dead);now=75;tick();assert(ws.dead);assert.equal(ws.listenerCount('pong'),0);
});
test('only main-frame navigation/failure and renderer loss invalidate readiness',()=>{
 const wc=new EventEmitter(),events=[];watchRenderer(wc,(...args)=>events.push(args));
 wc.emit('did-start-navigation',{},'url',false,false);wc.emit('did-start-navigation',{},'url',true,true);
 wc.emit('did-fail-load',{},-3,'canceled','url',true);assert.equal(events.length,0);
 wc.emit('did-start-navigation',{},'url',false,true);wc.emit('did-fail-load',{},-2,'failed','url',true);
 wc.emit('render-process-gone');wc.emit('destroyed');assert.equal(events.length,4);assert.equal(events.at(-1)[1],true);
});
test('replacing the initial loading DOM or mounting React does not complete startup',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const timers=new Map();let next=0,removed=0;
 const node=()=>({style:{},setAttribute(){},append(){},remove(){removed++;}});
 const document={body:node(),createElement:node,addEventListener(){},getElementById:()=>({children:[{}],querySelector:()=>null})};
 const events=[];const window={addEventListener(){},dispatchEvent:event=>events.push(event.type)};
 let fetches=0;
 vm.runInNewContext(fs.readFileSync('bridge/startup.js','utf8'),{window,document,location:{reload(){}},Event,performance,AbortController,
  fetch:async()=>{fetches++;return {ok:true,json:async()=>({})};},
  setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
 const startup=window.chatgptWebStartup;
 assert.equal(fetches,1,'inline startup requests bootstrap before deferred scripts execute');
 await startup.bootstrapReady;
 startup.hostReady();startup.entryReady();startup.phase('renderer_ready');
 assert.equal(removed,0,'React loading fallback must retain the startup watchdog');assert.equal(timers.size,1);
 startup.phase('first_content_visible');assert.equal(removed,1);assert.equal(timers.size,0);
 assert.deepEqual(events,['chatgpt-web:ready']);startup.phase('first_content_visible');assert.equal(events.length,1);
 assert.equal(startup.timings.at(-1).phase,'ready');
 assert(startup.timings.every(value=>value.ms>=0));
});

test('timeout preserves its reason even when abort synchronously rejects the fetch',async()=>{
 const controller=new AbortController();
 const request=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new DOMException('This operation was aborted','AbortError'))));
 await assert.rejects(wait(request,5,'explicit request timeout',()=>controller.abort()),error=>error.name==='TimeoutError'&&error.message==='explicit request timeout');
});
test('bootstrap retries a stalled request and transient gateway failures within its deadline',async()=>{
 let calls=0,firstSignal;
 const value=await bootstrap((_url,options)=>{
  assert.equal(options.credentials,'same-origin');assert.equal(options.priority,'high');calls++;
  if(calls===1){firstSignal=options.signal;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}
  if(calls===2)return Promise.resolve({status:502});
  if(calls===3)return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({ok:true,json:async()=>({ready:true})});
 },{timeout:500,requestTimeout:10,retry:1});
 assert.deepEqual(value,{ready:true});assert(firstSignal.aborted);assert.equal(calls,4);
 let denied=0;
 await assert.rejects(bootstrap(async()=>{denied++;return {status:403};},{retry:1}),/访问验证失败/);assert.equal(denied,1);
 let reads=0;
 assert.deepEqual(await bootstrap(async()=>({ok:true,json:()=>++reads===1?new Promise(()=>{}):Promise.resolve({ready:true})}),{timeout:500,requestTimeout:10,retry:1}),{ready:true});
});

test('resource errors identify the failed path without leaking query credentials or calling it a host failure',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),listeners=new Map(),nodes=[];
 const node=()=>{const value={style:{},setAttribute(){},append(){},remove(){}};nodes.push(value);return value;};
 const document={body:node(),createElement:node,addEventListener(){}};
 const window={addEventListener:(name,handler)=>listeners.set(name,handler),dispatchEvent(){}};
 vm.runInNewContext(fs.readFileSync('bridge/startup.js','utf8'),{window,document,location:{href:'http://127.0.0.1:18765/'},URL,Event,performance,AbortController,setTimeout,clearTimeout,
  fetch:async()=>({ok:true,json:async()=>({})})});
 await window.chatgptWebStartup.bootstrapReady;
 window.chatgptWebStartup.stage('等待宿主 App');
 listeners.get('error')({target:{tagName:'SCRIPT',src:'http://user:password@127.0.0.1:18765/static/version/bridge/client.js?token=secret'}});
 const message=nodes.find(value=>value.textContent?.includes('页面资源下载失败')).textContent;
 assert.match(message,/下载页面资源失败/);assert.match(message,/\/static\/version\/bridge\/client\.js/);
 assert(!/password|secret|等待宿主/.test(message));assert(window.chatgptWebStartup.failed);
});

test('occupied page waits for explicit confirmation before opening a takeover connection',async()=>{
 const {acquire}=require('../bridge/startup.js');let approve,shown,opened;
 const prompted=new Promise(resolve=>{shown=resolve;});
 const result=acquire({fetcher:async()=>({ok:true,json:async()=>({browser:true,clientId:'old-id'})}),confirm:()=>{shown();return new Promise(resolve=>{approve=resolve;});},makeSocket:path=>{
  opened=path;const ws=new Socket();queueMicrotask(()=>ws.dispatchEvent(new Event('open')));return ws;
 }});
 await prompted;assert.equal(opened,undefined);approve();await result;assert.equal(opened,'/bridge/socket?takeover=old-id');
});
test('connection races ask again for the new owner instead of silently stealing it',async()=>{
 const {acquire}=require('../bridge/startup.js');let confirmations=0,attempt=0;const urls=[];
 await acquire({fetcher:async()=>({ok:true,json:async()=>({browser:true,clientId:attempt?'new-id':'old-id'})}),confirm:async()=>{confirmations++;},makeSocket:path=>{
  urls.push(path);const ws=new Socket();const success=++attempt===2;queueMicrotask(()=>ws.dispatchEvent(new Event(success?'open':'error')));return ws;
 }});
 assert.equal(confirmations,2);assert.deepEqual(urls,['/bridge/socket?takeover=old-id','/bridge/socket?takeover=new-id']);
});
