'use strict';
const {randomUUID}=require('node:crypto');
// One active browser. The expected ID prevents stale confirmations from evicting
// a different browser that took control while the confirmation was displayed.
module.exports=function connections({onRelease=()=>{}}={}){
 let client=null;
 function release(ws){
  if(client!==ws)return;
  client=null;onRelease(ws);
 }
 return {
  get client(){return client;},
  forward(data,session){if(client?.readyState===1&&(!session||session===client.webClientId))client.send(data);},
  canAdmit(expected){return !client||client.webClientId===expected;},
  admit(ws,expected){
   if(client&&client.webClientId!==expected)return false;
   if(client){
    const previous=client;release(previous);
    previous.close(4001,'Connection taken over');
    const timer=setTimeout(()=>previous.terminate(),3000);timer.unref?.();
    previous.once('close',()=>clearTimeout(timer));
   }
   ws.webClientId=randomUUID();client=ws;
   ws.once('close',()=>release(ws));
   return true;
  },
 };
};
