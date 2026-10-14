'use strict';
const hostStartedAt=performance.now();let rendererReadyMs=null;
// Runs inside the original Electron main process, before its original entrypoint.
const {app, ipcMain, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {WebSocketServer} = require(path.join(process.env.CHATGPT_WEB_ROOT, 'node_modules/ws'));
const access=require('./web-access.cjs')();
const {port,origin}=access;
const originalHtml = fs.readFileSync(path.join(__dirname,'web-original.html'),'utf8');
const hostRenderer=JSON.parse(fs.readFileSync(path.join(process.env.CHATGPT_WEB_ROOT,'prepare-manifest.json'))).host_renderer;
const codec=require('./web-codec.js');
let peer = null;
let relayContentsId = null;
let snapshot = null;
let rendererState = 'starting';
let client = null;
let browserConnections=0,nativeHostConnections=0;
const bootstrapReader=require('./web-bootstrap.cjs')(message=>{
  if(peer?.readyState!==1)throw Error('App renderer unavailable');
  peer.send(JSON.stringify(message));
});
ipcMain.on('codex_desktop:connect-app-host',event=>{if(event.sender.id===relayContentsId)nativeHostConnections++;});
const folderPicker=require('./web-folders.cjs')({send:message=>client?.send(codec.pack(message))});
const uploads=require('./web-uploads.cjs')(path.join(process.env.CHATGPT_WEB_ROOT,'.uploads'));
const {resourcePath,serveFile}=require('./web-files.cjs');
const downloads=require('./web-downloads.cjs')(path.join(process.env.CHATGPT_WEB_ROOT,'.downloads'),{send:message=>client?.send(codec.pack(message))});
downloads.install();
const nativeSaveDialog=dialog.showSaveDialog.bind(dialog);
dialog.showSaveDialog=(...args)=>{
  const owner=args.length>1?args[0]:null;
  if(client?.readyState===1&&(!owner||owner.webContents?.id===relayContentsId))return downloads.open(args.length>1?args[1]:args[0]);
  return nativeSaveDialog(...args);
};
const nativeOpenDialog=dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog=(...args)=>{
  const options=args.length>1?args[1]:args[0];
  const owner=args.length>1?args[0]:null;
  if(client?.readyState===1 && (options?.properties?.includes('openDirectory') || options?.properties?.includes('openFile')) && (!owner || owner.webContents?.id===relayContentsId)){
    return folderPicker.open(options);
  }
  return nativeOpenDialog(...args);
};
const authorized=access.authorized;
const sendStatic=require('./web-static.cjs')({maxBytes:1024*1024});
const staticDirectory=path.join(process.env.CHATGPT_WEB_ROOT,'.runtime/web-static');
const staticManifest=JSON.parse(fs.readFileSync(path.join(staticDirectory,'manifest.json')));
const sendPrepared=require('./web-static.cjs').prepared(staticDirectory,staticManifest);
const staticPrefix=`/static/${staticManifest.version}/`;
const {heartbeat,watchRenderer}=require('./web-lifecycle.cjs');
const startupScript=fs.readFileSync(path.join(__dirname,'web-startup.js'),'utf8');
const page=Buffer.from(require('./web-page.cjs').renderPage(originalHtml,{startup:startupScript,
 version:staticManifest.version,websocketOrigin:access.websocketOrigin,preloads:staticManifest.preloads,title:process.env.CHATGPT_WEB_TITLE}));
function json(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
const server = http.createServer(async(req,res)=>{
  res.setHeader('Referrer-Policy','no-referrer');
  const u = new URL(req.url, origin);
  if (u.pathname === '/login' && access.acceptsToken(u.searchParams.get('token'))) {
    res.writeHead(303,{'set-cookie':access.cookie,location:'/','cache-control':'no-store'});return res.end();
  }
  if (!authorized(req)) {res.writeHead(401,{'cache-control':'no-store'});return res.end('Open the login URL printed by scripts/start.sh.');}
  if((req.method==='GET'||req.method==='HEAD')&&u.pathname.startsWith('/@fs/')){
    try{void serveFile(req,res,resourcePath(u));}catch{json(res,400,{error:'Invalid resource path'});}return;
  }
  if((req.method==='GET'||req.method==='HEAD')&&u.pathname.startsWith('/bridge/download/')){
    const file=downloads.get(u.pathname.slice('/bridge/download/'.length));
    if(!file)return json(res,404,{error:'Download is unavailable'});
    void serveFile(req,res,file.path,{downloadName:file.name});return;
  }
  if(u.pathname==='/bridge/upload' && req.method==='POST'){
    if(!access.allowsWebSocket(req)||req.headers['x-chatgpt-web-upload']!=='1')return json(res,403,{error:'Invalid upload origin'});
    const owner=client;
    if(!owner||owner.readyState!==1)return json(res,409,{error:'请先连接 Web UI'});
    uploads.receive(req,owner,()=>client===owner&&owner.readyState===1)
      .then(value=>json(res,201,value))
      .catch(error=>{if(!res.destroyed){req.resume();json(res,error.status||400,{error:error.message});}});
    return;
  }
  if(u.pathname==='/bridge/bootstrap'){
    if(!snapshot)return json(res,503,{error:'App renderer is not ready'});
    try{return json(res,200,await bootstrapReader.read());}
    catch{return json(res,503,{error:'App renderer is not ready'});}
  }
  if(u.pathname==='/bridge/status') return json(res,200,{peer:!!peer,snapshot:!!snapshot,browser:!!client,rendererState,hostRenderer,persistentHost:hostRenderer==='minimal',browserConnections,nativeHostConnections,uptimeMs:Math.round(performance.now()-hostStartedAt),rendererReadyMs,staticVersion:staticManifest.version});
  if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
  try {
    const versioned=u.pathname.startsWith(staticPrefix);
    if(u.pathname.startsWith('/static/')&&!versioned){res.writeHead(404,{'cache-control':'no-store'});return res.end('Resource version expired; reload the page');}
    const relative=decodeURIComponent(versioned?u.pathname.slice(staticPrefix.length):u.pathname.slice(1));
    if(Object.hasOwn(staticManifest.entries,relative))return await sendPrepared(req,res,relative,{immutable:versioned});
    if(!versioned&&(relative===''||relative==='index.html'||!path.extname(relative)))return await sendStatic(req,res,page,'text/html');
    res.writeHead(404,{'cache-control':'no-store'});res.end('Not found');
  }catch(e){if(!res.headersSent){res.writeHead(500,{'cache-control':'no-store'});res.end('Resource unavailable');}else res.destroy();}
});
const wss = new WebSocketServer({noServer:true,maxPayload:32*1024*1024});
server.on('upgrade',(req,socket,head)=>{
  const u=new URL(req.url,origin);
  if(u.pathname!=='/bridge/socket' || !authorized(req) || !access.allowsWebSocket(req)) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  if(client) {socket.end('HTTP/1.1 409 Conflict\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{
    browserConnections++;
    client=ws;heartbeat(ws,{onTick:()=>ws.send(codec.pack({kind:'heartbeat'}))});
    ws.on('message',async data=>{
      let message;try{message=codec.unpack(data.toString());}catch{ws.close(1007,'Invalid message');return;}
      if(message.kind==='call' && typeof message.method==='string' && (message.method.startsWith('folder.')||message.method.startsWith('upload.')||message.method==='download.choose')){
        try{
          let value;
          if(message.method==='download.choose')await downloads.choose(...message.args);
          else if(message.method==='upload.retain')uploads.retain(message.args[0],ws);
          else if(message.method==='upload.discardGroup')await uploads.discardGroup(message.args[0],ws);
          else if(message.method==='upload.discard')await uploads.discard(message.args[0],ws);
          else if(message.method==='folder.selectUploads'){
            const [id,ids]=message.args;
            value=await folderPicker.call('folder.select',[id,uploads.paths(ids,ws)]);uploads.retain(ids,ws);
          }else value=await folderPicker.call(message.method,message.args);
          if(ws.readyState===1)ws.send(codec.pack({kind:'result',id:message.id,value}));}
        catch(error){if(ws.readyState===1)ws.send(codec.pack({kind:'result',id:message.id,error:error.message}));}
        return;
      }
      if(peer?.readyState===1)peer.send(data.toString());
      else ws.close(1013,'App renderer unavailable');
    });
    ws.on('close',()=>{void uploads.cancel(ws).catch(error=>console.error('[uploads]',error.message));if(client!==ws)return;folderPicker.cancel();downloads.cancel();client=null;peer?.send(JSON.stringify({kind:'disconnect'}));});
  });
});
const relayTargets = new Set();
ipcMain.on('chatgpt-web:from-relay',(event,data)=>{
  if(event.sender.id!==relayContentsId || !relayTargets.has(event.sender.id))return;
  let message;try{message=JSON.parse(data);}catch{return;}
  if(message.kind==='bootstrap-fresh'){
    if(bootstrapReader.receive(message)&&!message.error)snapshot=message.value;
    return;
  }
  if(message.kind==='host-state'){rendererState='warming';console.log('[chatgpt-web] 正在预热宿主服务…');return;}
  if(message.kind==='host-error'){
    peer=null;snapshot=null;bootstrapReader.reset();rendererState='host connection failed';rendererReadyMs=null;
    console.error('[chatgpt-web] 宿主服务连接失效，请重启服务。',codec.decode(message.value));
    client?.close(1012,'App host connection failed');return;
  }
  if(message.kind==='snapshot'){
    const wc=event.sender;
    peer={readyState:1,send:data=>{if(!wc.isDestroyed())wc.send('chatgpt-web:to-relay',data);},close:()=>{}};
    snapshot=message.value;rendererState='ready';rendererReadyMs=Math.round(performance.now()-hostStartedAt);
    console.log(hostRenderer==='minimal'?'[chatgpt-web] 宿主已就绪，后续浏览器连接将复用服务。':'[chatgpt-web] 宿主界面已就绪（full 模式）。');return;
  }
  if(message.kind==='event' && snapshot){
    const eventValue=codec.decode(message.value);
    // Without a native UI, undeliverable chunks have no consumer to acknowledge
    // them. Release the host sender's flow-control wait instead of retaining it.
    if(hostRenderer==='minimal'&&client?.readyState!==1&&eventValue?.marker==='codex-host-chunked-message-v1'&&typeof eventValue.transferId==='string'&&Number.isSafeInteger(eventValue.sequence)){
      peer?.send(JSON.stringify({kind:'ack-discarded-chunk',transferId:eventValue.transferId,sequence:eventValue.sequence}));
    }
    if(eventValue?.type==='shared-object-updated'){
      const current=codec.decode(snapshot);current.shared[eventValue.key]=eventValue.value;snapshot=codec.encode(current);
    }
  }
  if(client?.readyState===1)client.send(data);
});
server.on('error',err=>{console.error('[chatgpt-web]',err.message);app.quit();});
server.listen(port,access.host,()=>{
  const dir=path.join(process.env.CHATGPT_WEB_ROOT,'.logs');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dir,'access-url'),`${access.accessUrl}\n`,{mode:0o600});
  if(access.mode==='none')console.log('[chatgpt-webui] Access-token authentication is disabled.');
  console.log(`[chatgpt-webui] Open ${access.accessUrl}`);
});
app.on('web-contents-created',(_event,wc)=>{
  let generation=0;
  const invalidate=(reason,destroyed=false)=>{
    generation++;
    relayTargets.delete(wc.id);
    if(relayContentsId!==wc.id)return;
    if(destroyed)relayContentsId=null;
    peer=null;snapshot=null;bootstrapReader.reset();rendererState=reason;rendererReadyMs=null;
    console.warn('[chatgpt-web]',reason);
    client?.close(1012,reason);
  };
  watchRenderer(wc,invalidate);
  wc.on('did-finish-load',()=>{
    const url=wc.getURL();
    if(!url.startsWith('app://') && !url.startsWith('codex://') && !url.startsWith('file://'))return;
    // Auxiliary renderers (e.g. avatar overlay) also have electronBridge.
    // Keep the first primary renderer as the single owner of the browser relay.
    if(relayContentsId!==null && relayContentsId!==wc.id)return;
    relayContentsId=wc.id;
    relayTargets.add(wc.id);
    const source=fs.readFileSync(path.join(__dirname,'web-relay.js'),'utf8');
    const codec=fs.readFileSync(path.join(__dirname,'web-codec.js'),'utf8');
    const current=generation;
    wc.executeJavaScript(`${codec};(${source})()`).catch(e=>{if(current===generation)invalidate('App bridge injection failed');console.error('[chatgpt-web] injection failed',e.message);});
  });
});
app.on('before-quit',()=>{bootstrapReader.reset();client?.close();peer?.close();server.close();});
