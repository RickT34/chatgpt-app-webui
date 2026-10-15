const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup({fetcher}={}){
 const listeners=new Map(),calls=[],requests=[],status={children:[],get textContent(){return this.children.map(x=>x.textContent).join('');},replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},remove(){this.removed=true;}},location={href:'http://test/local/thread'};
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};this.strings=new Map();}setData(type,value){this.strings.set(type,value);}getData(type){return this.strings.get(type)||'';}}
 class Drop{constructor(type,options){this.type=type;Object.assign(this,options);}}
 const context={window,document:{getElementById:()=>status,createElement:()=>({})},location,setTimeout,clearTimeout,AbortController,WeakMap,WeakSet,Set,Map,Array,crypto,DataTransfer:Transfer,DragEvent:Drop,ClipboardEvent:Drop,
  fetch:async(url,options)=>{requests.push({url,options});if(fetcher)return fetcher(url,options);return {ok:true,json:async()=>({id:'upload-'+requests.length,path:'/host/upload-'+requests.length,name:'test.txt'})};}};
 vm.runInNewContext(fs.readFileSync('bridge/attachments.js','utf8'),context);
 const adapter=window.chatgptWebAttachments(async(...args)=>{calls.push(args);});
 return {listeners,calls,requests,status,location,adapter};
}
test('file drop uploads bytes, exposes a synchronous path and replays only once',async()=>{
 const state=setup(),file=new File(['hello'],'test.txt',{type:'text/plain'});let replay,prevented=false,stopped=false;
 const target={isConnected:true,dispatchEvent:event=>{replay=event;void state.listeners.get('drop')(event);return false;}};
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
 const target={isConnected:true,dispatchEvent(){replayed=true;return false;}};
 const dropped=state.listeners.get('drop')({target,dataTransfer:{files:[file],items:[]},preventDefault(){},stopImmediatePropagation(){}});
 state.status.children.find(n=>n.textContent==='关闭').onclick();
 await dropped;assert(state.status.removed);assert(replayed);
 assert.match(state.status.textContent,/正在上传/,'completion must not recreate a dismissed notification');
});
function pasteEvent(files,{target,strings={}}={}){
 return {target:target||{isConnected:true,closest:()=>({}),getBoundingClientRect:()=>({left:10,top:20,width:400,height:100}),dispatchEvent(){return false;}},
  clipboardData:{files,items:files.map(file=>({kind:'file',getAsFile:()=>file})),types:['Files',...Object.keys(strings)],getData:type=>strings[type]||''},
  preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
}
test('pasted files enter the drop receiver once with host paths and no clipboard path text',async()=>{
 const state=setup(),files=[new File(['image bytes'],'截图.png',{type:'image/png'}),new File(['document'],'notes.txt')];let replay;
 const event=pasteEvent(files,{strings:{'text/plain':'notes.txt','text/html':'<b>notes.txt</b>'}});
 event.target.dispatchEvent=value=>{replay=value;value.target=event.target;void state.listeners.get(value.type)(value);return false;};
 const pending=state.listeners.get('paste')(event);
 event.clipboardData.files=[];event.clipboardData.getData=()=>''; // Native clipboard expires after dispatch.
 await pending;
 assert(event.defaultPrevented&&event.stopped);assert.equal(state.requests.length,2);
 assert.equal(state.requests[0].options.body,files[0]);assert.equal(state.requests[1].options.body,files[1]);
 assert.equal(replay.type,'drop');assert.equal(replay.dataTransfer.getData('text/plain'),'');
 assert.equal(replay.dataTransfer.getData('text/html'),'');
 assert.equal(replay.clientX,210);assert.equal(replay.clientY,70);
 assert.equal(state.adapter.getPathForFile(replay.dataTransfer.files[1]),'/host/upload-2');
 assert.equal(state.calls.length,1);assert.equal(state.calls[0][0],'upload.retain');
 assert.deepEqual(Array.from(state.calls[0][1]),['upload-1','upload-2']);
});
test('file items work when the browser exposes an empty clipboard FileList',async()=>{
 const state=setup(),event=pasteEvent([new File(['x'],'item.txt')]);event.clipboardData.files=[];
 await state.listeners.get('paste')(event);
 assert.equal(state.requests.length,1);assert.equal(state.requests[0].options.body.name,'item.txt');
});
test('text paste and file paste outside the conversation editor remain untouched',async()=>{
 const state=setup(),text=pasteEvent([],{strings:{'text/plain':'hello'}});
 const other=pasteEvent([new File(['x'],'a.txt')]);other.target.closest=()=>null;
 await state.listeners.get('paste')(text);await state.listeners.get('paste')(other);
 assert.equal(text.defaultPrevented,undefined);assert.equal(other.defaultPrevented,undefined);assert.equal(state.requests.length,0);
});
test('pasted attachments are discarded if the conversation changes during upload',async()=>{
 const state=setup(),event=pasteEvent([new File(['x'],'a.txt')]);let dispatched=false;
 event.target.dispatchEvent=()=>{dispatched=true;};
 const pending=state.listeners.get('paste')(event);state.location.href='http://test/other-thread';await pending;
 assert.equal(dispatched,false);assert.equal(state.calls[0][0],'upload.discardGroup');
 assert(!state.calls.some(([method])=>method==='upload.retain'));
});
test('partial paste failure discards its batch without delivering any attachments',async()=>{
 let n=0;const state=setup({fetcher:async()=>++n===1?{ok:true,json:async()=>({id:'first',path:'/host/first'})}:{ok:false,json:async()=>({error:'disk full'})}});
 const event=pasteEvent([new File(['a'],'a.txt'),new File(['b'],'b.txt')]);let dispatched=false;event.target.dispatchEvent=()=>{dispatched=true;};
 await state.listeners.get('paste')(event);
 assert.equal(dispatched,false);assert.equal(state.calls[0][0],'upload.discardGroup');assert.match(state.status.textContent,/disk full/);
});
test('disconnect aborts pasted uploads and removes the paste listener',async()=>{
 let finish;const state=setup({fetcher:()=>new Promise(resolve=>{finish=resolve;})}),event=pasteEvent([new File(['x'],'a.txt')]);
 let dispatched=false;event.target.dispatchEvent=()=>{dispatched=true;};const pending=state.listeners.get('paste')(event);
 state.adapter.close();assert.equal(state.requests[0].options.signal.aborted,true);assert.equal(state.listeners.has('paste'),false);
 finish({ok:true,json:async()=>({id:'late',path:'/host/late'})});await pending;
 assert.equal(dispatched,false);assert.equal(state.calls.length,0);
});
test('oversized clipboard files are rejected before network upload',async()=>{
 const state=setup();await state.listeners.get('paste')(pasteEvent([{name:'large.bin',size:32*1024*1024+1}]));
 assert.equal(state.requests.length,0);assert.match(state.status.textContent,/32 MiB/);
});

test('unclaimed pasted files are discarded instead of reporting success',async()=>{
 const state=setup(),event=pasteEvent([new File(['x'],'a.txt')]);
 event.target.dispatchEvent=()=>true; // DOM dispatch returns true when nobody prevents default.
 await state.listeners.get('paste')(event);
 assert.equal(state.calls.length,1);assert.equal(state.calls[0][0],'upload.discardGroup');
 assert.equal(state.calls[0][1],state.requests[0].options.headers['X-Upload-Group']);
 assert.match(state.status.textContent,/输入框未接收附件/);
 assert.doesNotMatch(state.status.textContent,/已交给|已上传/);
});
test('image paste uses the uploaded path via drop, without entering native paste persistence',async()=>{
 const state=setup(),file=new File(['png bytes'],'image.png',{type:'image/png'}),event=pasteEvent([file]);
 const attachments=[];
 event.target.dispatchEvent=replay=>{
  // The original image handler ignores getPathForFile for source=paste.
  assert.equal(replay.type,'drop');
  for(const value of replay.dataTransfer.files)attachments.push({name:value.name,path:state.adapter.getPathForFile(value)});
  assert.equal(state.calls.length,0,'retain only after the receiver accepts the event');
  return false;
 };
 await state.listeners.get('paste')(event);
 assert.deepEqual(attachments,[{name:'image.png',path:'/host/upload-1'}]);
 assert.equal(state.calls[0][0],'upload.retain');
 assert.match(state.status.textContent,/已交给输入框/);
});
