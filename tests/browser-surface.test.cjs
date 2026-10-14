const {test}=require('node:test'),assert=require('node:assert/strict');
const createSurface=require('../bridge/browser-surface.cjs');
const {point}=require('../bridge/browser-view.js');
function fixture(){
 let owner='active',clock=1000;const sent=[],sender={id:1};
 const image={isEmpty:()=>false,getSize:()=>({width:800,height:600}),toJPEG:()=>Buffer.from('frame')};
 const guest={id:2,isDestroyed:()=>false,getType:()=> 'webview',hostWebContents:sender,capturePage:async()=>image,focus(){},sendInputEvent:e=>sent.push(e),debugger:{isAttached:()=>true,sendCommand:async(method,args)=>sent.push({method,...args})}};
 const request=createSurface({getGuest:id=>id===2?guest:null,isOwner:(from,session)=>from===sender&&session===owner,now:()=>clock});
 return {guest,image,sent,sender,request:(value={})=>request(sender,{session:'active',guestId:2,action:'frame',...value}),takeover(){owner='replacement';},advance(){clock+=1000;}};
}
test('surface refuses stale connections and guests from another native window',async()=>{
 const f=fixture();f.guest.hostWebContents={id:99};
 await assert.rejects(f.request(),/unavailable/);
 f.takeover();await assert.rejects(f.request({action:'text',text:'must not type'}),/connection changed/);
 assert.deepEqual(f.sent,[]);
});
test('concurrent frame reads coalesce and unchanged revisions omit image bytes',async()=>{
 const f=fixture();let captures=0;f.guest.capturePage=async()=>{captures++;return f.image;};
 const frames=await Promise.all([f.request(),f.request()]);
 assert.equal(captures,1);assert.deepEqual(frames[0].bytes,Buffer.from('frame'));
 assert.deepEqual(await f.request({revision:frames[0].revision}),{revision:frames[0].revision});
 f.advance();assert.deepEqual(await f.request({revision:frames[0].revision}),{revision:frames[0].revision});
 assert.equal(captures,2,'unchanged pages are recaptured to detect later updates');
});
test('capture completion after connection takeover cannot disclose the old frame',async()=>{
 const f=fixture();let finish;f.guest.capturePage=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.request();await Promise.resolve();f.takeover();finish(f.image);
 await assert.rejects(pending,/connection changed/);
});
test('a failed capture releases its slot and allows a later retry',async()=>{
 const f=fixture();f.guest.capturePage=async()=>{throw Error('capture failed');};
 await assert.rejects(f.request(),/capture failed/);
 f.guest.capturePage=async()=>f.image;
 assert.deepEqual((await f.request()).bytes,Buffer.from('frame'));
});
test('invalid input cannot reach Electron and text preserves Unicode',async()=>{
 const f=fixture();
 await assert.rejects(f.request({action:'input',event:{type:'mouseDown',x:NaN,y:5}}),/coordinates/);
 await assert.rejects(f.request({action:'input',event:{type:'keyDown',keyCode:'A',modifiers:['unknown']}}),/modifiers/);
 await assert.rejects(f.request({action:'execute',script:'arbitrary code'}),/Unsupported/);
 assert.deepEqual(f.sent,[]);
 await f.request({action:'text',text:'你好，Codex 👋'});
 await f.request({action:'input',event:{type:'mouseWheel',x:10.4,y:20.7,deltaX:0,deltaY:-400}});
 assert.deepEqual(f.sent[0],{method:'Input.insertText',text:'你好，Codex 👋'});
 assert.deepEqual(f.sent.at(-1),{type:'mouseWheel',x:10,y:21,deltaX:0,deltaY:-400,canScroll:true,modifiers:[]});
});
test('letterboxing maps displayed pixels into the actual native viewport',()=>{
 const rect={left:10,top:20,width:1000,height:1000},frame={width:1280,height:720};
 assert.deepEqual(point(rect,frame,510,520),{x:640,y:360});
 assert.equal(point(rect,frame,510,100),null,'top letterbox must not click the page');
 assert.equal(point(rect,frame,1010,520),null,'right edge lies outside the viewport');
 assert.equal(point(rect,null,100,100),null,'no input before the first frame');
});

test('text input preserves an existing debugger and releases only its own attachment',async()=>{
 const f=fixture();let attached=false,attachments=0,detachments=0;
 f.guest.debugger={isAttached:()=>attached,attach(){attached=true;attachments++;},detach(){attached=false;detachments++;},async sendCommand(){throw Error('navigation interrupted');}};
 await assert.rejects(f.request({action:'text',text:'hello'}),/navigation interrupted/);
 assert.equal(attachments,1);assert.equal(detachments,1);assert.equal(attached,false);
 attached=true;f.guest.debugger.sendCommand=async()=>{};
 await f.request({action:'text',text:'你好'});
 assert.equal(attached,true);assert.equal(detachments,1);
});
