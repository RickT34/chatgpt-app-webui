'use strict';
// Repeated browser-protocol connections, without UI automation or model calls.
const fs=require('node:fs'),{once}=require('node:events');
const {WebSocket}=require('ws'),codec=require('../bridge/codec.js');
const {bootstrap,acquire,socketBootstrap}=require('../bridge/startup.js');
async function main(){
 const login=fs.readFileSync('.logs/access-url','utf8').trim(),base=new URL(login).origin;
 const auth=await fetch(login,{redirect:'manual'}),cookie=(auth.headers.get('set-cookie')||'').split(';')[0];
 const {newMessagePortRpcSession}=await import('capnweb');
 const measurements=[];
 for(let i=0;i<4;i++){
  const fetcher=(url,options)=>fetch(base+url,{...options,headers:{cookie}});
  const state=await bootstrap(fetcher,{connection:true});let snapshot;
  const ws=await acquire({state,fetcher,confirm:()=>{throw Error('Smoke test refuses to take over an existing browser');},makeSocket:path=>{
   const socket=new WebSocket(base.replace(/^http/,'ws')+path+'?bootstrap=1',{headers:{cookie,origin:base}});
   snapshot=socketBootstrap(socket);snapshot.catch(()=>{});return socket;
  }});
  const initial=codec.decode(await snapshot);
  if(!initial.shared||!('getInitialSidebarBootstrap' in initial))throw Error('Missing fresh WebSocket bootstrap');
  const started=performance.now();
  const {port1,port2}=new MessageChannel();
  const root=newMessagePortRpcSession(port1,{services:{downloads:{stateChanged(){}},appUpdates:{stateChanged(){}},clientCoordination:{}}});
  ws.on('message',data=>{const m=codec.unpack(data.toString());if(m.kind==='port'&&m.id===1)port2.postMessage(m.value);});
  port2.onmessage=e=>ws.send(codec.pack({kind:'port',id:1,value:e.data}));
  ws.send(codec.pack({kind:'port-open',id:1}));
  try{
   const services=await root.services;
   await services.startup.whenReady();const info=await services.appInfo.get();
   measurements.push({connection:i+1,readyMs:Math.round(performance.now()-started),version:info.version,services:Object.keys(services).length});
   services[Symbol.dispose]();
  }finally{root[Symbol.dispose]();port1.close();port2.close();ws.close();await once(ws,'close');}
 }
 const status=await (await fetch(base+'/bridge/status',{headers:{cookie}})).json();
 if(status.persistentHost&&status.nativeHostConnections!==1)throw Error('Native App-host was recreated');
 console.log(JSON.stringify({measurements,status}));
}
const timer=setTimeout(()=>{console.error('Repeated connection test timed out');process.exit(1);},40000);timer.unref();
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(timer));
