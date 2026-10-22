'use strict';
// Local HTTP/WS fixture with one added RTT per request/upgrade. Measures bridge
// setup only, without touching a running App, user data, nginx or Docker.
const http=require('node:http'),assert=require('node:assert/strict');
const {once}=require('node:events'),{WebSocket,WebSocketServer}=require('ws');
const {bootstrap,acquire,socketBootstrap}=require('../bridge/startup.js');
const createReader=require('../bridge/bootstrap.cjs'),codec=require('../bridge/codec.js');
async function measure(rtt){
 let requests=0,reads=0;
 const snapshot={shared:{current:true},getInitialSidebarBootstrap:{threads:['fixture']}};
 const reader=createReader(message=>{reads++;queueMicrotask(()=>reader.receive({kind:'bootstrap-fresh',id:message.id,value:codec.encode(snapshot)}));});
 const server=http.createServer((req,res)=>{
  requests++;
  setTimeout(async()=>{
   const url=new URL(req.url,'http://localhost');
   const value=url.pathname==='/bridge/status'||url.searchParams.has('connect')?{browser:false,clientId:null}:await reader.read();
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));
  },rtt);
 });
 const wss=new WebSocketServer({noServer:true});
 server.on('upgrade',(req,socket,head)=>setTimeout(()=>wss.handleUpgrade(req,socket,head,ws=>{
  if(new URL(req.url,'http://localhost').searchParams.has('bootstrap'))void createReader.send(ws,reader,()=>true);
 }),rtt));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}`,fetcher=(url,options)=>fetch(base+url,options),results=[];
 try{
  for(const optimized of [false,true]){
   requests=0;reads=0;const start=performance.now();
   const initial=await bootstrap(fetcher,{connection:optimized});let pending;
   const socket=await acquire({state:optimized?initial:undefined,fetcher,confirm:()=>{throw Error('Unexpected takeover');},makeSocket:path=>{
    const ws=new WebSocket(base.replace('http:','ws:')+path+(optimized?'?bootstrap=1':''));
    if(optimized){pending=socketBootstrap(ws);pending.catch(()=>{});}return ws;
   }});
   try{
    const actual=codec.decode(optimized?await pending:await bootstrap(fetcher));
    assert.deepEqual(actual,snapshot);
    results.push({path:optimized?'optimized':'previous',readyMs:Math.round(performance.now()-start),httpRequests:requests,hostSnapshotReads:reads});
    assert.equal(requests,optimized?1:3);assert.equal(reads,optimized?1:2);
   }finally{socket.close();await once(socket,'close');}
  }
 }finally{for(const ws of wss.clients)ws.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 return {simulatedRttMs:rtt,results};
}
(async()=>{for(const rtt of [0,100,300])console.log(JSON.stringify(await measure(rtt)));})().catch(error=>{console.error(error);process.exitCode=1;});
