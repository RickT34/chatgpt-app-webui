const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
 const listeners=new Map(),calls=[],requests=[],status={children:[],get textContent(){return this.children.map(x=>x.textContent).join('');},replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},remove(){this.removed=true;}},location={href:'http://test/local/thread'};
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 class Drop{constructor(type,options){this.type=type;Object.assign(this,options);}}
 const context={window,document:{getElementById:()=>status,createElement:()=>({})},location,setTimeout,clearTimeout,AbortController,WeakMap,WeakSet,Set,Map,Array,crypto,DataTransfer:Transfer,DragEvent:Drop,
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({id:'upload-'+requests.length,path:'/host/upload-'+requests.length,name:'test.txt'})};}};
 vm.runInNewContext(fs.readFileSync('bridge/attachments.js','utf8'),context);
 const adapter=window.chatgptWebAttachments(async(...args)=>{calls.push(args);});
 return {listeners,calls,requests,status,location,adapter};
}
test('file drop uploads bytes, exposes a synchronous path and replays only once',async()=>{
 const state=setup(),file=new File(['hello'],'test.txt',{type:'text/plain'});let replay,prevented=false,stopped=false;
 const target={isConnected:true,dispatchEvent:event=>{replay=event;return state.listeners.get('drop')(event);}};
 await state.listeners.get('drop')({target,dataTransfer:{files:[file],items:[]},preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}});
 assert(prevented&&stopped);assert.equal(state.requests.length,1);assert.equal(state.requests[0].options.body,file);
 assert.equal(replay.type,'drop');assert.equal(state.adapter.getPathForFile(replay.dataTransfer.files[0]),'/host/upload-1');
 assert.equal(state.calls[0][0],'upload.retain');
});
test('drop canceled by route change never dispatches into another conversation',async()=>{
 const state=setup();let dispatched=false;
 const target={get isConnected(){state.location.href='http://test/another-thread';return true;},dispatchEvent:()=>{dispatched=true;}};
 await state.listeners.get('drop')({target,dataTransfer:{files:[new File(['x'],'a.txt')],items:[]},preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(dispatched,false);assert(state.calls.some(args=>args[0]==='upload.discardGroup'));
});
test('text drags pass through and client directories are rejected before upload',async()=>{
 const state=setup();let prevented=false;
 await state.listeners.get('drop')({dataTransfer:{files:[]},preventDefault(){prevented=true;}});assert.equal(prevented,false);
 await state.listeners.get('drop')({target:{},dataTransfer:{files:[{}],items:[{webkitGetAsEntry:()=>({isDirectory:true})}]},preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(state.requests.length,0);assert.match(state.status.textContent,/文件夹/);
});
test('dismissed upload progress stays hidden when the same drop completes',async()=>{
 const state=setup(),file=new File(['hello'],'test.txt');let replayed=false;
 const target={isConnected:true,dispatchEvent(){replayed=true;}};
 const dropped=state.listeners.get('drop')({target,dataTransfer:{files:[file],items:[]},preventDefault(){},stopImmediatePropagation(){}});
 state.status.children.find(n=>n.textContent==='关闭').onclick();
 await dropped;assert(state.status.removed);assert(replayed);
 assert.match(state.status.textContent,/正在上传/,'completion must not recreate a dismissed notification');
});
