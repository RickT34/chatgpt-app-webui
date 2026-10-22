'use strict';
// Coalesce simultaneous HTTP bootstrap requests without caching a snapshot
// across browser visits. Only the matching resident renderer response can win.
module.exports=function createBootstrapReader(send,{timeout=5000}={}){
 let pending=null,nextId=1;
 const finish=(error,value)=>{
  if(!pending)return;
  const current=pending;pending=null;clearTimeout(current.timer);
  if(error)current.reject(error);else current.resolve(value);
 };
 return {
  read(){
   if(pending)return pending.promise;
   let resolve,reject;
   const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
   const id=nextId++,timer=setTimeout(()=>finish(Error('App bootstrap refresh timed out')),timeout);
   pending={id,promise,resolve,reject,timer};
   try{send({kind:'bootstrap-refresh',id});}catch(error){finish(error);}
   return promise;
  },
  receive(message){
   if(!pending||message.kind!=='bootstrap-fresh'||message.id!==pending.id)return false;
   finish(message.error?Error(message.error):null,message.value);return true;
  },
  reset(){finish(Error('App renderer unavailable'));},
 };
};

// Send a fresh snapshot after admission, including after a delayed takeover.
// The reader already returns codec-encoded data; do not encode it a second time.
module.exports.send=async function sendBootstrap(ws,reader,isCurrent){
 try{
  const value=await reader.read();
  if(isCurrent()&&ws.readyState===1)ws.send(JSON.stringify({kind:'bootstrap',value}));
 }catch{
  if(isCurrent()&&ws.readyState===1)ws.close(1013,'App bootstrap unavailable');
 }
};
