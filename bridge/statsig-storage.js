// Statsig's multi-megabyte evaluation cache exceeds localStorage's quota.
// Keep the SDK's synchronous storage interface, backed by an IndexedDB cache.
(function(root){
 'use strict';
 function createStorage(local,persistence,{warn=()=>{},maxBytes=16*1024*1024,maxEntries=4}={}){
  const values=new Map(),touched=new Set();let ready=false,dirty=false,saving=false,warned=false;
  const cached=key=>key.startsWith('statsig.cached.');
  const report=()=>{if(!warned){warned=true;warn();}};
  const trim=()=>{
   let bytes=0;for(const [key,value] of values)bytes+=(key.length+value.length)*2;
   while(values.size&&(bytes>maxBytes||values.size>maxEntries)){
    const [key,value]=values.entries().next().value;values.delete(key);bytes-=(key.length+value.length)*2;
   }
  };
  async function save(){
   if(!ready||saving)return;saving=true;
   try{while(dirty){dirty=false;await persistence.save([...values]);}}
   catch{report();}
   finally{saving=false;}
  }
  const loaded=Promise.resolve().then(()=>persistence.load()).then(rows=>{
   if(!Array.isArray(rows))throw Error('Invalid cache');
   const pending=[...values];values.clear();
   for(const row of rows){
    if(!Array.isArray(row))continue;
    const [key,value]=row;
    if(typeof key==='string'&&cached(key)&&typeof value==='string'&&!touched.has(key))values.set(key,value);
   }
   for(const [key,value] of pending)values.set(key,value);
   trim();
  }).catch(report).finally(()=>{ready=true;touched.clear();void save();});
  return {
   isReady:()=>ready,isReadyResolver:()=>loaded,getProviderName:()=> 'WebUIIndexedDB',
   getItem:key=>cached(key)?values.get(key)??local.getItem(key):local.getItem(key),
   setItem(key,value){
    if(!cached(key)){local.setItem(key,value);return;}
    if(!ready)touched.add(key);values.delete(key);values.set(key,value);trim();dirty=true;void save();
   },
   removeItem(key){
    if(cached(key)){if(!ready)touched.add(key);values.delete(key);dirty=true;void save();}
    local.removeItem(key);
   },
   getAllKeys:()=>[...new Set([...Object.keys(local),...values.keys()])],
  };
 }
 function indexedPersistence(indexedDB){
  let database;
  const opened=new Promise((resolve,reject)=>{
   const request=indexedDB.open('chatgpt-web-statsig',1);
   const timer=setTimeout(()=>reject(Error('Cache open timed out')),2000);
   request.onupgradeneeded=()=>request.result.createObjectStore('cache');
   request.onerror=()=>{clearTimeout(timer);reject(request.error);};
   request.onblocked=()=>{clearTimeout(timer);reject(Error('Cache open blocked'));};
   request.onsuccess=()=>{clearTimeout(timer);database=request.result;database.onversionchange=()=>database.close();resolve(database);};
  });
  async function transaction(mode,action){
   const db=await opened;
   return new Promise((resolve,reject)=>{
    const tx=db.transaction('cache',mode),request=action(tx.objectStore('cache'));
    tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error||Error('Cache transaction aborted'));
    tx.onerror=()=>{};
   });
  }
  return {load:async()=>await transaction('readonly',store=>store.get('values'))??[],save:rows=>transaction('readwrite',store=>store.put(rows,'values'))};
 }
 if(typeof module==='object')module.exports={createStorage};
 else {
  let provider;
  // Do not open/read the database when the original SDK disables storage.
  root.chatgptWebCreateStatsigStorage=()=>{
   try{return provider??=createStorage(root.localStorage,indexedPersistence(root.indexedDB),{
    warn:()=>console.warn('[chatgpt-web] 浏览器配置缓存不可用，本次继续使用内存缓存。'),
   });}catch{return undefined;}
  };
 }
})(globalThis);
