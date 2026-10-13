'use strict';
// Real nginx, private ports and a pinned temporary TLS certificate. No Docker,
// user profile, system config reload, external requests or model calls.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),https=require('node:https'),http2=require('node:http2');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {WebSocket,WebSocketServer}=require('ws');
const zlib=require('node:zlib');
const digest=data=>createHash('sha256').update(data).digest('hex');
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function sparePort(){const server=http.createServer();const port=await listen(server);await new Promise(resolve=>server.close(resolve));return port;}
async function main(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chatgpt-nginx-'));
 const payload=randomBytes(4*1024*1024),compressed=zlib.gzipSync(payload),expected=digest(compressed);
 const backend=http.createServer((req,res)=>{
  if(req.url==='/asset.js'){
   res.writeHead(200,{'content-type':'text/javascript','content-encoding':'gzip','content-length':compressed.length,'cache-control':'private, max-age=31536000, immutable','vary':'Accept-Encoding'});res.end(compressed);
  }else{
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify({connection:req.headers.connection??null,socket:req.socket.remotePort}));
  }
 });
 const wss=new WebSocketServer({noServer:true});backend.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>ws.on('message',data=>ws.send(data))));
 let nginx,client,agent;
 try{
  const backendPort=await listen(backend),tlsPort=await sparePort(),redirectPort=await sparePort();
  const key=path.join(folder,'key.pem'),cert=path.join(folder,'cert.pem');
  const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const template=fs.readFileSync(path.join(__dirname,'../deploy/nginx.conf'),'utf8')
   .replace('server 127.0.0.1:18765;',`server 127.0.0.1:${backendPort};`)
   .replace('listen 80;',`listen 127.0.0.1:${redirectPort};`)
   .replace('listen 443 ssl;',`listen 127.0.0.1:${tlsPort} ssl;`)
   .replaceAll('chatgpt.example.com','localhost')
   .replace('/etc/letsencrypt/live/localhost/fullchain.pem',cert)
   .replace('/etc/letsencrypt/live/localhost/privkey.pem',key);
  const config=path.join(folder,'nginx.conf');
  fs.writeFileSync(config,`daemon off;\nworker_processes 1;\npid ${folder}/nginx.pid;\nerror_log ${folder}/error.log;\nevents { worker_connections 128; }\nhttp { client_body_temp_path ${folder}/body; proxy_temp_path ${folder}/proxy;\n${template}\n}`);
  const check=spawnSync('nginx',['-t','-p',folder+'/','-c',config],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  nginx=spawn('nginx',['-p',folder+'/','-c',config],{stdio:'ignore'});
  const ca=fs.readFileSync(cert);agent=new https.Agent({ca,keepAlive:true});
  function request(url='/'){
   return new Promise((resolve,reject)=>{
    const req=https.get({hostname:'127.0.0.1',port:tlsPort,path:url,agent},res=>{
     const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('nginx request timed out')));
   });
  }
  let first;
  for(let attempt=0;attempt<40;attempt++){
   try{first=await request();break;}catch(error){if(nginx.exitCode!==null)throw Error(fs.readFileSync(path.join(folder,'error.log'),'utf8'));if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,50));}
  }
  const sockets=new Set([JSON.parse(first.body).socket]);
  for(let i=0;i<5;i++){
   const response=await request(),value=JSON.parse(response.body);assert.equal(response.status,200);assert.notEqual(value.connection,'close');sockets.add(value.socket);
   assert.match(response.headers['x-webui-upstream-connect-time'],/^\d+\.\d+$/);assert.match(response.headers['x-webui-upstream-header-time'],/^\d+\.\d+$/);
  }
  assert.equal(sockets.size,1,'ordinary requests should reuse the upstream connection');
  console.log('PASS: nginx config, verified TLS, upstream keepalive and upstream timing headers');
  const large=await request('/asset.js');assert.equal(digest(large.body),expected);assert.equal(large.headers['content-encoding'],'gzip');
  assert.equal(Number(large.headers['content-length']),compressed.length);
  client=http2.connect(`https://127.0.0.1:${tlsPort}`,{ca,servername:'localhost'});await once(client,'connect');
  assert.equal(client.alpnProtocol,'h2');
  await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
   const stream=client.request({':path':'/asset.js'}),chunks=[];stream.on('error',reject);stream.on('response',headers=>{assert.equal(headers[':status'],200);});
   stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{try{assert.equal(digest(Buffer.concat(chunks)),expected);resolve();}catch(error){reject(error);}});stream.end();
  })));
  console.log('PASS: HTTP/1.1 and six concurrent HTTP/2 large responses preserve exact compressed bytes');
  const ws=new WebSocket(`wss://127.0.0.1:${tlsPort}/bridge/socket`,{ca});await once(ws,'open');
  const echo=once(ws,'message');ws.send('nginx-upgrade-check');assert.equal((await echo)[0].toString(),'nginx-upgrade-check');
  ws.close();await once(ws,'close');console.log('PASS: WebSocket upgrade and bidirectional messages');
 }finally{
  client?.destroy();agent?.destroy();for(const ws of wss.clients)ws.terminate();
  if(nginx&&nginx.exitCode===null){nginx.kill('SIGTERM');await once(nginx,'exit');}
  backend.closeAllConnections();await new Promise(resolve=>backend.close(resolve));wss.close();
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
const deadline=setTimeout(()=>{console.error('nginx integration check timed out');process.exit(1);},60000);deadline.unref();
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
