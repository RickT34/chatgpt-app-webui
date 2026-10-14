async function connectRelay(createHost) {
  if (!window.electronBridge || window.__chatgptWebRelay) return;
  window.__chatgptWebRelay = true;
  const bridge = window.electronBridge;
  const ws = {readyState:1,send:data=>window.chatgptWebTransport.send(data)};
  window.chatgptWebTransport.subscribe(data=>ws.onmessage?.({data}));
  const ports = new Map();
  const workers = new Map();
  const sharedSubscriptions = new Set();
  const minimal=window.document?.documentElement?.dataset.chatgptWebHost==='minimal';
  const send = value => {if(ws.readyState===1)ws.send(window.chatgptWebCodec.pack(value));};
  let warmHost=null,generation=0;
  if(minimal){
    send({kind:'host-state',value:'warming'});
    createHost??=(await import(new URL('web-host.mjs',window.location.href).href)).createWarmHost;
    const {port1,port2}=new MessageChannel();
    warmHost=createHost(port1,{onBroken:error=>send({kind:'host-error',value:error.message})});
    window.postMessage({type:'connect-app-host',port:port2},window.location.origin,[port2]);
    await warmHost.ready;
  }
  function readSnapshot(){
    const snapshot = {};
    for(const name of ['getSystemThemeVariant','getSentryInitOptions','getDesktopUserAgent','getAppSessionId','getBuildFlavor','getInitialSidebarBootstrap','isDeviceCheckSupported','isIntelMacBuild']) {
      try {
        // The official preload memoizes its sidebar getter for the lifetime of
        // the native window. Our resident window needs a fresh IPC read instead.
        snapshot[name]=name==='getInitialSidebarBootstrap'&&window.chatgptWebTransport.getInitialSidebarBootstrap
          ?window.chatgptWebTransport.getInitialSidebarBootstrap():bridge[name]?.();
      }catch(e){console.warn('[chatgpt-web]',name,e.message);}
    }
    snapshot.shared = window.chatgptWebTransport.getSnapshot() || {};
    return snapshot;
  }
  send({kind:'snapshot',value:readSnapshot()});
  window.addEventListener('message',event=>{
    // The original preload dispatches synthetic MessageEvents with source === null.
    if((event.source!==null && event.source!==window) || event.data?.type==='connect-app-host')return;
    try{send({kind:'event',value:event.data});}catch{}
  });
  bridge.subscribeToSystemThemeVariant(()=>send({kind:'theme',value:bridge.getSystemThemeVariant()}));
  ws.onmessage=async event=>{
    const m=window.chatgptWebCodec.unpack(event.data);
    try{
      if(m.kind==='bootstrap-refresh'){send({kind:'bootstrap-fresh',id:m.id,value:readSnapshot()});return;}
      if(m.kind==='disconnect') {
        generation++;
        for(const entry of ports.values()){entry.detach?.();entry.port.close();}ports.clear();
        for(const stop of workers.values())stop();workers.clear();
        // The full native UI shares this window's subscriptions; only the minimal
        // host can release all subscriptions owned by the disconnected browser.
        if(minimal){for(const key of sharedSubscriptions)void bridge.sendMessageFromView({type:'shared-object-unsubscribe',key}).catch(()=>{});sharedSubscriptions.clear();}
        return;
      }
      if(m.kind==='ack-discarded-chunk') {if(minimal)bridge.acknowledgeChunkedMessage(m.transferId,m.sequence);return;}
      if(m.kind==='port-open'){
        const {port1,port2}=new MessageChannel(),entry={port:port1};ports.set(m.id,entry);
        port1.onmessage=e=>send({kind:'port',id:m.id,value:e.data});
        if(warmHost){
          const current=generation;entry.detach=await warmHost.attach(port2);
          if(current!==generation){entry.detach();port1.close();}
        }else window.postMessage({type:'connect-app-host',port:port2},window.location.origin,[port2]);
        return;
      }
      if(m.kind==='port'){ports.get(m.id)?.port.postMessage(m.value);return;}
      if(m.kind==='worker-subscribe'){
        if(!workers.has(m.id))workers.set(m.id,bridge.subscribeToWorkerMessages(m.id,value=>send({kind:'worker',id:m.id,value})));return;
      }
      if(m.kind==='worker-unsubscribe'){workers.get(m.id)?.();workers.delete(m.id);return;}
      if(m.kind==='call'){
        const allowed=['sendMessageFromView','sendWorkerMessageFromView','acknowledgeChunkedMessage','getFastModeRolloutMetrics','showContextMenu','getSharedObjectSnapshotValue'];
        if(!allowed.includes(m.method))throw Error(`Unsupported bridge method: ${m.method}`);
        if(minimal&&m.method==='sendMessageFromView'&&typeof m.args?.[0]?.key==='string'){
          const {type,key}=m.args[0];
          if(type==='shared-object-subscribe')sharedSubscriptions.add(key);
          if(type==='shared-object-unsubscribe')sharedSubscriptions.delete(key);
        }
        const value=await bridge[m.method](...m.args);send({kind:'result',id:m.id,value});
      }
    }catch(e){
      if(m.kind==='bootstrap-refresh')send({kind:'bootstrap-fresh',id:m.id,error:e.message});
      else if(m.kind==='port-open'){ports.get(m.id)?.port.close();ports.delete(m.id);send({kind:'port',id:m.id,value:null});}
      else send({kind:'result',id:m.id,error:e.message});
    }
  };
}
