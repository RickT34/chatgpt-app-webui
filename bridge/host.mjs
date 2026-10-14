import {RpcTarget,newMessagePortRpcSession} from './capnweb.js';
import {HttpFetch} from './rpc-client.mjs';

// One native App-host connection belongs to the host renderer's lifetime.
// Browser connections only borrow services; reconnects never rebuild AppHost.
export function createWarmHost(nativePort,{onBroken=()=>{},adaptServices=()=>({})}={}){
 const clients=new Set(),latest=new Map();let active=null,closed=false;
 const notifications=new Set(['downloads.stateChanged','appUpdates.stateChanged']);
 const callbackService=name=>new Proxy(new RpcTarget(),{
  get(target,method){
   if(typeof method!=='string'||method in target||method==='then')return Reflect.get(target,method);
   return async(...args)=>{
    const key=`${name}.${method}`;
    if(notifications.has(key)){
     try{latest.set(key,structuredClone(args));}catch{latest.delete(key);}
    }
    const client=active;
    if(!client){
     if(notifications.has(key))return;
     if(name==='clientCoordination'&&method==='ownsThread')return false;
     throw Error('Browser is disconnected; reconnect to handle this request');
    }
    const services=await client.viewServices;
    if(client!==active||client.closed)throw Error('Browser connection changed');
    try{return await services[name][method](...args);}
    catch(error){if(client.closed&&notifications.has(key))return;throw error;}
   };
  }
 });
 const callbacks=new Proxy(new RpcTarget(),{
  get(target,name){
   if(typeof name!=='string'||name in target||name==='then')return Reflect.get(target,name);
   return callbackService(name);
  }
 });
 class View extends RpcTarget{get services(){return callbacks;}}
 const native=newMessagePortRpcSession(nativePort,new View());
 native.onRpcBroken(error=>{if(!closed)onBroken(error);});
 const services=Promise.resolve(native.services);
 const warmRead=async call=>{
  try{const value=await call;value?.[Symbol.dispose]?.();}
  finally{call[Symbol.dispose]();}
 };
 let overrides={};
 const ready=services.then(async value=>{
  await warmRead(value.startup.whenReady());
  await warmRead(value.appInfo.get());
  overrides=await adaptServices(value,RpcTarget);
 });
 ready.catch(()=>{});
 async function attach(port){
  await ready;
  if(closed)throw Error('Host connection closed');
  const source=await services,borrowed={};
  for(const [key,value] of Object.entries(source))borrowed[key]=Object.hasOwn(overrides,key)?overrides[key]:value?.dup?value.dup():value;
  const fetch=source.httpFetch?new HttpFetch(source.httpFetch):null;
  if(fetch){borrowed.httpFetch?.[Symbol.dispose]();borrowed.httpFetch=fetch;}
  const client={closed:false,viewServices:null};
  class Host extends RpcTarget{get services(){return borrowed;}}
  const view=newMessagePortRpcSession(port,new Host());
  client.viewServices=Promise.resolve(view.services);
  // Keep native publishers attached to this stable View and send their current
  // bounded state to the next browser. Never replay actions or approvals.
  client.viewServices.then(async value=>{
   if(client.closed){value[Symbol.dispose]?.();return;}
   for(const [key,args] of latest){
    if(client!==active||client.closed)break;
    const [name,method]=key.split('.');await value[name][method](...args);
   }
  }).catch(()=>{});
  const disconnect=()=>{
   if(client.closed)return;client.closed=true;clients.delete(disconnect);
   if(active===client)active=null;
   fetch?.[Symbol.dispose]();view[Symbol.dispose]();port.close();
  };
  client.disconnect=disconnect;clients.add(disconnect);active=client;
  return disconnect;
 }
 return {ready,attach,close(){
  if(closed)return;closed=true;
  for(const disconnect of clients)disconnect();
  latest.clear();services.then(value=>value[Symbol.dispose](),()=>{});
  native[Symbol.dispose]();nativePort.close();
 }};
}
