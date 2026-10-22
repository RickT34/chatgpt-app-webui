const {test}=require('node:test');
const assert=require('node:assert/strict');
const createReader=require('../bridge/bootstrap.cjs');

test('bootstrap coalesces concurrent requests but asks the resident host again on the next visit',async()=>{
 const sent=[],reader=createReader(message=>sent.push(message));
 assert.equal(reader.receive({kind:'bootstrap-fresh',value:'unsolicited'}),false);
 const first=reader.read(),same=reader.read();assert.equal(first,same);assert.equal(sent.length,1);
 assert.equal(reader.receive({kind:'bootstrap-fresh',id:99,value:'stale'}),false);
 reader.receive({kind:'bootstrap-fresh',id:sent[0].id,value:{catalogEntries:['first']}});
 assert.deepEqual(await first,{catalogEntries:['first']});
 const next=reader.read();assert.equal(sent.length,2);
 reader.receive({kind:'bootstrap-fresh',id:sent[0].id,value:'late'});
 reader.receive({kind:'bootstrap-fresh',id:sent[1].id,value:{catalogEntries:['updated']}});
 assert.deepEqual(await next,{catalogEntries:['updated']});
});

test('admitted sockets receive one fresh encoded snapshot without another HTTP fetch',async()=>{
 const codec=require('../bridge/codec.js'),sent=[],reader=createReader(message=>sent.push(message));
 const frames=[],ws={readyState:1,send:frame=>frames.push(frame)};
 const sending=createReader.send(ws,reader,()=>true);
 const snapshot={shared:{value:new Uint8Array([4,5])},getInitialSidebarBootstrap:{threads:['current']}};
 reader.receive({kind:'bootstrap-fresh',id:sent[0].id,value:codec.encode(snapshot)});await sending;
 assert.equal(frames.length,1);assert.deepEqual(codec.unpack(frames[0]),{kind:'bootstrap',value:snapshot});
});
test('a superseded browser cannot receive a late snapshot',async()=>{
 let finish,current=true;const frames=[];
 const sending=createReader.send({readyState:1,send:frame=>frames.push(frame)},{read:()=>new Promise(resolve=>{finish=resolve;})},()=>current);
 current=false;finish('private snapshot');await sending;assert.deepEqual(frames,[]);
});
test('unavailable snapshots close only the current browser',async()=>{
 const closed=[],ws={readyState:1,close:(...args)=>closed.push(args)},reader={read:async()=>{throw Error('renderer lost');}};
 await createReader.send(ws,reader,()=>true);assert.deepEqual(closed,[[1013,'App bootstrap unavailable']]);
 await createReader.send(ws,reader,()=>false);assert.equal(closed.length,1);
});
test('renderer loss, errors and timeouts reject instead of returning an old bootstrap',async()=>{
 const sent=[],reader=createReader(message=>sent.push(message),{timeout:10});
 const disconnected=reader.read();reader.reset();await assert.rejects(disconnected,/unavailable/);
 const failed=reader.read();reader.receive({kind:'bootstrap-fresh',id:sent.at(-1).id,error:'reload'});await assert.rejects(failed,/reload/);
 await assert.rejects(reader.read(),/timed out/);
 const current=reader.read();reader.receive({kind:'bootstrap-fresh',id:sent.at(-1).id,value:'current'});assert.equal(await current,'current');
 await assert.rejects(createReader(()=>{throw Error('not connected');}).read(),/not connected/);
});
