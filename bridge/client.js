'use strict';
// Capture the versioned script URL before the first await. Download the RPC
// adapter while bootstrap/WS are pending; execution of the App still waits.
const chatgptWebRpcUrl=new URL('rpc-client.mjs',document.currentScript.src).href;
window.chatgptWebReady=(async()=>{
  const startup=window.chatgptWebStartup;
  const adapter=startup.wait(import(chatgptWebRpcUrl),120000,'桥接模块下载超时。');
  adapter.catch(()=>{});
  startup.stage('等待宿主 App',65000);
  const bootstrap=window.chatgptWebCodec.decode(await startup.bootstrapReady);
  if(startup.failed)throw Error('启动已中止，请重试。');
  startup.stage('连接宿主机',20000);
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/bridge/socket`);
  const queued=[];ws.onmessage=event=>queued.push(event);
  ws.addEventListener('close',()=>startup.fail(Error('连接已断开，请重新加载；宿主 App 可能已重启。')));
  window.addEventListener('chatgpt-web:failed',()=>ws.close(1000,'Client startup failed'),{once:true});
  window.addEventListener('pagehide',()=>ws.close(1000,'Page left'),{once:true});
  await startup.connect(ws);
  startup.stage('下载桥接模块');
  const {adaptAppHost}=await adapter;
  if(startup.failed)throw Error('启动已中止，请重试。');
  const adaptedPorts=new Map();
  let nextId=1;
  const pending=new Map(), ports=new Map(), workers=new Map(), themeSubscribers=new Set();
  const shared=bootstrap.shared || {};
  const send=value=>ws.send(window.chatgptWebCodec.pack(value));
  const call=(method,...args)=>new Promise((resolve,reject)=>{
    const id=nextId++;
    const interactivePicker=method==='sendMessageFromView' && args[0]?.type==='fetch' && /^vscode:\/\/codex\/(?:pick-files?|save-file)$/.test(args[0]?.url||'');
    const timer=interactivePicker?null:setTimeout(()=>{pending.delete(id);reject(Error(`Bridge timeout: ${method}`));},60000);
    pending.set(id,{resolve,reject,timer});send({kind:'call',method,args,id});
  });
  const native=window.chatgptWebNative(call);
  const folderPicker=window.chatgptWebFolderPicker(call);
  const attachments=window.chatgptWebAttachments(call);
  window.codexWindowType='electron';
  window.electronBridge={
    windowType:'electron',getPreloadStartedAtMs:()=>performance.timeOrigin,
    ...Object.fromEntries(Object.entries(bootstrap).filter(([k])=>k!=='shared').map(([k,v])=>[k,()=>v])),
    sendMessageFromView:message=>{if(message.type==='shared-object-set')shared[message.key]=message.value;return call('sendMessageFromView',message);},
    acknowledgeChunkedMessage:(...args)=>{void call('acknowledgeChunkedMessage',...args);},
    sendWorkerMessageFromView:(...args)=>call('sendWorkerMessageFromView',...args),
    subscribeToWorkerMessages:(id,callback)=>{
      if(!workers.has(id)){workers.set(id,new Set());send({kind:'worker-subscribe',id});}
      const callbacks=workers.get(id);callbacks.add(callback);
      return()=>{
        if(!callbacks.delete(callback)||callbacks.size||workers.get(id)!==callbacks)return;
        workers.delete(id);if(ws.readyState===1)send({kind:'worker-unsubscribe',id});
      };
    },
    getSharedObjectSnapshotValue:key=>shared[key],
    getSystemThemeVariant:()=>bootstrap.getSystemThemeVariant,
    subscribeToSystemThemeVariant:cb=>{themeSubscribers.add(cb);return()=>themeSubscribers.delete(cb);},
    getPathForFile:file=>attachments.getPathForFile(file),startFileDrag:()=>false,startLinkDrag:()=>{},
    // Omitting showContextMenu selects the original frontend's web menu implementation.
    getFastModeRolloutMetrics:(...args)=>call('getFastModeRolloutMetrics',...args),
    triggerSentryTestError:async()=>{},
  };
  document.documentElement.dataset.theme=bootstrap.getSystemThemeVariant;
  window.addEventListener('message',event=>{
    if(event.source!==window || event.data?.type!=='connect-app-host')return;
    const id=nextId++, adapted=adaptAppHost(event.data.port || event.ports[0],native.clipboard,{onPhase:phase=>startup.phase(phase)}),port=adapted.port;
    adaptedPorts.set(id,adapted);
    ports.set(id,port);port.onmessage=e=>send({kind:'port',id,value:e.data});
    send({kind:'port-open',id});
    startup.stage('等待 App 服务',65000);
    startup.wait(adapted.ready(),60000,'App 服务握手超时，请检查宿主 App 后重试。').then(()=>startup.hostReady(),error=>startup.fail(error));
  });
  let lastMessage=Date.now();
  const liveness=setInterval(()=>{if(Date.now()-lastMessage>60000)startup.fail(Error('长时间未收到宿主机响应，请检查网络后重新加载。'));},15000);
  ws.onmessage=event=>{
    lastMessage=Date.now();
    const m=window.chatgptWebResources.rewrite(window.chatgptWebCodec.unpack(event.data));
    if(m.kind==='heartbeat')return;
    if(m.kind==='save-open'){native.save(m.value);return;}
    if(m.kind==='download-ready'){native.ready(m.value);return;}
    if(m.kind==='file-open'){attachments.open(m.value);return;}
    if(m.kind==='folder-open'){folderPicker.open(m.value);return;}
    if(m.kind==='result'){
      const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);
      m.error?p.reject(Error(m.error)):p.resolve(m.value);
    }else if(m.kind==='port')ports.get(m.id)?.postMessage(m.value);
    else if(m.kind==='worker')workers.get(m.id)?.forEach(cb=>cb(m.value));
    else if(m.kind==='theme'){bootstrap.getSystemThemeVariant=m.value;themeSubscribers.forEach(cb=>cb());}
    else if(m.kind==='event'){
      if(m.value?.type==='shared-object-updated')shared[m.value.key]=m.value.value;
      window.dispatchEvent(new MessageEvent('message',{data:m.value}));
    }
  };
  for(const event of queued)ws.onmessage(event);
  queued.length=0;
  ws.onclose=()=>{
    clearInterval(liveness);
    folderPicker.close();attachments.close();native.close();
    for(const adapted of adaptedPorts.values())adapted.close();adaptedPorts.clear();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('App bridge disconnected'));}pending.clear();
    startup.fail(Error('App 连接已断开，请重新加载。'));
  };
})();
window.chatgptWebReady.catch(error=>window.chatgptWebStartup.fail(error));
