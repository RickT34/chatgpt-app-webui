'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws');
const createConnections=require('../bridge/connections.cjs');
const createAccess=require('../bridge/access.cjs');
async function fixture(run){
 const released=[],connections=createConnections({onRelease:ws=>released.push(ws.webClientId)});
 const access=createAccess({CHATGPT_WEB_ORIGIN:'http://client.test'}),wss=new WebSocketServer({noServer:true});
 const server=http.createServer();
 server.on('upgrade',(req,socket,head)=>{
  const expected=new URL(req.url,'http://local').searchParams.get('takeover');
  if(!access.authorized(req)||!access.allowsWebSocket(req)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  if(!connections.canAdmit(expected)){socket.end('HTTP/1.1 409 Conflict\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{if(!connections.admit(ws,expected)){ws.close(4009);return;}ws.on('message',value=>{if(connections.client===ws)ws.send(value);});});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const clients=[];
 async function open(expected,headers={cookie:access.cookie.split(';')[0],origin:access.origin}){
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/bridge/socket${expected?'?takeover='+expected:''}`,{headers});clients.push(ws);await once(ws,'open');return ws;
 }
 try{await run({open,connections,released,access});}finally{for(const ws of clients)ws.terminate();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));wss.close();}
}
test('second connection needs confirmation; takeover closes old transport and new client stays usable',()=>fixture(async({open,connections,released})=>{
 const first=await open(),old=connections.client.webClientId;
 await assert.rejects(open(),/409/);assert.equal(connections.client.webClientId,old);assert.deepEqual(released,[]);
 const closed=once(first,'close');const next=await open(old);const [code]=await closed;
 assert.equal(code,4001);assert.deepEqual(released,[old]);assert.notEqual(connections.client.webClientId,old);
 const echoed=once(next,'message');connections.forward('stale response',old);next.send('still connected');assert.equal((await echoed)[0].toString(),'still connected');
}));
test('stale simultaneous confirmation cannot evict the device that just took over',()=>fixture(async({open,connections})=>{
 await open();const original=connections.client.webClientId;await open(original);const replacement=connections.client.webClientId;
 await assert.rejects(open(original),/409/);assert.equal(connections.client.webClientId,replacement);
}));
test('takeover requires authentication and the correct page Origin',()=>fixture(async({open,connections,access})=>{
 await open();const original=connections.client.webClientId;
 await assert.rejects(open(original,{origin:access.origin}),/403/);
 await assert.rejects(open(original,{cookie:access.cookie.split(';')[0],origin:'http://other.test'}),/403/);
 assert.equal(connections.client.webClientId,original);
}));
