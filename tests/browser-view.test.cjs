const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

// A DOM boundary fixture: unlike Electron, an empty inline <webview> ignores
// width/height. Real browser verification covers layout and image decoding.
function fixture({hidden=false,capture}={}){
 const timers=new Map(),calls=[],revoked=[];let nextTimer=0;
 class Element{
  constructor(tag){this.tag=tag;this.style={};this.children=[];this.isConnected=true;this.hidden=false;}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  setAttribute(){}
  getAttribute(name){return name.endsWith('conversation-id')?'thread':'tab';}
  closest(){return null;}
  addEventListener(){}
  removeEventListener(){}
  remove(){this.isConnected=false;this.parentElement.children=this.parentElement.children.filter(e=>e!==this);}
  decode(){return Promise.resolve();}
  getBoundingClientRect(){const width=this.style.display==='block'?800:0;return {left:100,top:100,right:100+width,bottom:700,width,height:width?600:0};}
 }
 const parent=new Element('div'),element=new Element('webview');parent.append(element);
 parent.style.visibility=hidden?'hidden':'visible';element.style.width='800px';element.style.height='600px';
 const document={hidden:false,querySelectorAll:()=>[element],createElement:tag=>new Element(tag)};
 const context=vm.createContext({document,innerWidth:1200,innerHeight:900,Blob,
  getComputedStyle:e=>({display:e.style.display??(e.tag==='webview'?'inline':'block'),position:'static',visibility:e.style.visibility??'visible',opacity:'1'}),
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:url=>revoked.push(url)}});
 vm.runInContext(fs.readFileSync('bridge/browser-view.js','utf8'),context);
 const view=context.chatgptWebBrowserView.create(async(method,route,payload)=>{
  calls.push({method,route,payload});return capture?capture():{width:800,height:600,revision:'frame',bytes:new Uint8Array([1,2,3])};
 });
 return {view,parent,element,calls,revoked,timers,async tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}};
}
test('an empty inline webview in a presented native panel requests and displays its first frame',async()=>{
 const f=fixture();assert.equal(f.element.getBoundingClientRect().width,0);
 await f.tick();
 assert.equal(f.calls.length,1,'layout must be established before the visibility gate');
 assert.equal(f.calls[0].payload.action,'frame');
 assert.equal(f.element.children.find(e=>e.tag==='img')?.src,'blob:fixture');
 f.view.close();assert.deepEqual(f.revoked,['blob:fixture']);assert.equal(f.timers.size,0);
});
test('hidden native panels remain idle and start capturing only when presented',async()=>{
 const f=fixture({hidden:true});await f.tick();assert.equal(f.calls.length,0);
 f.parent.style.visibility='visible';await f.tick();assert.equal(f.calls.length,1);
 f.parent.style.visibility='hidden';await f.tick();assert.equal(f.calls.length,1);
 f.view.close();
});
test('disconnect during first capture does not mount a late image or restart polling',async()=>{
 let finish;const f=fixture({capture:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=f.tick();f.view.close();finish({width:800,height:600,revision:'late',bytes:new Uint8Array([1])});await pending;
 assert.equal(f.element.children.length,0);assert.equal(f.timers.size,0);assert.equal(f.revoked.length,0);
});
