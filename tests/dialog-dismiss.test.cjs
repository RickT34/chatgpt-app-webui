'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
function setup(file){
 const nodes=[],listeners=new Map(),events=[],timers=new Map();let next=0,reloads=0;
 const node=()=>{
  const queries=new Map();
  const n={style:{},children:[],setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},remove(){this.removed=true;},close(){this.closed=true;},showModal(){},focus(){},select(){},addEventListener(){},querySelector(selector){if(!queries.has(selector))queries.set(selector,node());return queries.get(selector);},querySelectorAll(){return [];}};
  nodes.push(n);return n;
 };
 const document={body:node(),createElement:node,querySelectorAll:()=>[],addEventListener(){}};
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>events.push(event.type)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,document,navigator:{},location:{reload(){reloads++;}},Event,performance,AbortController,console,
  fetch:async()=>({ok:true,json:async()=>({})}),setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
 return {window,document,nodes,listeners,events,timers,get reloads(){return reloads;}};
}
test('startup timeout can be dismissed without disconnecting, reloading or preventing late readiness',async()=>{
 const s=setup('bridge/startup.js'),startup=s.window.chatgptWebStartup;
 await startup.bootstrapReady;
 startup.hostReady();startup.entryReady();
 [...s.timers.values()][0]();
 assert.equal(startup.failed,false);assert.deepEqual(s.events,[]);
 const panel=s.document.body.children[0];panel.children.find(n=>n.textContent==='关闭').onclick();
 assert(panel.removed);assert.equal(s.reloads,0);
 startup.phase('first_content_visible');assert.deepEqual(s.events,['chatgpt-web:ready']);
 assert.equal(s.document.body.children.length,1,'dismissed warning must not reappear');
});
test('fatal startup notice closes without reload and stays dismissed on repeated failures',async()=>{
 const s=setup('bridge/startup.js'),startup=s.window.chatgptWebStartup;await startup.bootstrapReady;
 startup.fail(Error('offline'));
 const panel=s.document.body.children[0];panel.children.find(n=>n.textContent==='关闭').onclick();startup.fail(Error('offline again'));
 assert(panel.removed);assert.equal(s.reloads,0);assert.equal(s.document.body.children.length,1);
});
test('closing takeover confirmation rejects acquisition without opening a socket',async()=>{
 const s=setup('bridge/startup.js'),startup=s.window.chatgptWebStartup;await startup.bootstrapReady;
 let opened=false,prompted;
 const shown=new Promise(resolve=>{prompted=resolve;});
 const acquisition=startup.acquire({fetcher:async()=>({ok:true,json:async()=>({browser:true,clientId:'owner'})}),confirm:()=>{const p=startup.confirmTakeover();prompted();return p;},makeSocket:()=>{opened=true;}});
 await shown;s.document.body.children[0].children.find(n=>n.textContent==='关闭').onclick();
 await assert.rejects(acquisition,{name:'AbortError'});assert.equal(opened,false);assert.equal(s.reloads,0);
});
test('folder close removes modal immediately even when host cancellation never replies',()=>{
 const s=setup('bridge/folder-picker.js'),calls=[];
 const picker=s.window.chatgptWebFolderPicker((...args)=>{calls.push(args);return new Promise(()=>{});});
 picker.open({id:'folder',home:'/home',initialPath:'/home'});
 const modal=s.document.body.children[0];modal.querySelector('[data-action=close]').onclick();
 assert(modal.removed&&modal.closed);assert(calls.some(args=>args[0]==='folder.cancel'));assert(!s.listeners.has('keydown'));
});
test('clipboard close settles its pending request and removes the dialog',async()=>{
 const s=setup('bridge/browser-native.js'),adapter=s.window.chatgptWebNative(async()=>{});
 const result=adapter.clipboard.writeText('hello'),modal=s.document.body.children[0];
 modal.children.find(n=>n.className==='web-dialog-close').onclick();
 await assert.rejects(result,/复制已取消/);assert(modal.removed);assert(!s.listeners.has('keydown'));
});
test('attachment close during commit hides immediately without discarding files being attached',async()=>{
 const s=setup('bridge/attachments.js'),calls=[];let complete;
 const adapter=s.window.chatgptWebAttachments((...args)=>{calls.push(args);return new Promise(resolve=>{complete=resolve;});});
 adapter.open({id:'files',home:'/home',initialPath:'/home'});
 const modal=s.document.body.children[0],committed=modal.querySelector('[data-action=add]').onclick();
 modal.querySelector('[data-action=close]').onclick();assert(modal.removed);
 assert.deepEqual(calls.map(args=>args[0]),['folder.selectUploads']);complete();await committed;
 assert.deepEqual(calls.map(args=>args[0]),['folder.selectUploads']);
});
test('save dialog close cancels the host request without waiting for it',()=>{
 const s=setup('bridge/browser-native.js'),calls=[];
 const adapter=s.window.chatgptWebNative((...args)=>{calls.push(args);return new Promise(()=>{});});
 adapter.save({id:'save',name:'result.txt'});
 const modal=s.document.body.children[0];modal.children.find(n=>n.className==='web-dialog-close').onclick();
 assert(modal.removed);assert.deepEqual(calls,[['download.choose','save',null]]);
});
test('failed attachment commit after dismissal cleans up abandoned uploads',async()=>{
 const s=setup('bridge/attachments.js'),calls=[];let reject;
 const adapter=s.window.chatgptWebAttachments((...args)=>{calls.push(args);return args[0]==='folder.selectUploads'?new Promise((_,no)=>{reject=no;}):Promise.resolve();});
 adapter.open({id:'files',home:'/home',initialPath:'/home'});
 const modal=s.document.body.children[0],committed=modal.querySelector('[data-action=add]').onclick();
 modal.querySelector('[data-action=close]').onclick();reject(Error('host rejected'));await committed;
 assert(modal.removed);assert.deepEqual(calls.map(args=>args[0]),['folder.selectUploads','upload.discardGroup','folder.cancel']);
});
