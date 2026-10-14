(function(root){
 'use strict';
 // Match the entire SDK user, including account, host device, locale, version,
 // session and experimental attributes. Never reuse assignments by user ID alone.
 function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
  return value;
 }
 const identity=user=>JSON.stringify(canonical(user));
 function initialize(client,options,record,{now=Date.now,refresh=()=>{},mark=()=>{},maxAge=600000}={}){
  if(options?.disableStorage||client.loadingStatus!=='Uninitialized'||!record?.payload)return client;
  try{
   const context=client.getContext();
   if(record.sdkKey!==context.sdkKey)return client;
   const data=JSON.parse(record.payload),age=now()-data.time;
   if(data.has_updates!==true||typeof data.time!=='number'||!Number.isFinite(age)||age<0||age>maxAge||!data.user)return client;
   if(['feature_gates','dynamic_configs','layer_configs'].some(key=>!data[key]||typeof data[key]!=='object'||Array.isArray(data[key])))return client;
   const user=identity(context.user);
   if(identity(data.user)!==user)return client;
   client.dataAdapter.setData(record.payload);
   // Use the SDK's bootstrap path; retain its normal value validation, exposure
   // logging and live refresh. A fresh validation follows the first real frame.
   client.initializeSync({disableBackgroundCacheRefresh:true});
   if(client.loadingStatus==='Ready'){
    mark();
    refresh(()=>{
     if(client.loadingStatus!=='Ready'||identity(client.getContext().user)!==user)return;
     return client.refreshValuesAsync();
    });
   }
  }catch{/* Invalid or unsupported bootstrap data falls back to the SDK. */}
  return client;
 }
 if(typeof module==='object'&&module.exports){module.exports={initialize};return;}
 function afterContent(run){
  if(root.chatgptWebStartup?.failed)return;
  let timer;
  const cleanup=()=>{clearTimeout(timer);root.removeEventListener('chatgpt-web:ready',ready);root.removeEventListener('chatgpt-web:failed',cleanup);root.removeEventListener('pagehide',cleanup);};
  const update=()=>{cleanup();void Promise.resolve().then(run).catch(()=>{});};
  const ready=()=>{clearTimeout(timer);timer=setTimeout(update,1000);};
  root.addEventListener('chatgpt-web:ready',ready,{once:true});
  root.addEventListener('chatgpt-web:failed',cleanup,{once:true});
  root.addEventListener('pagehide',cleanup,{once:true});
  // Also validate if an unrelated part of the page never finishes startup.
  timer=setTimeout(update,30000);
  if(root.chatgptWebStartup?.timings.some(value=>value.phase==='ready'))ready();
 }
 root.chatgptWebInitializeStatsig=(client,options)=>initialize(client,options,root.chatgptWebGetStatsigBootstrap?.(),{
  refresh:afterContent,mark:()=>root.performance.mark('chatgpt-web:config-cache-hit')
 });
})(globalThis);
