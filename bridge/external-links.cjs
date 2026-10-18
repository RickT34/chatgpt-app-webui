'use strict';
// Keep the App's destination policy and remote URL resolution, replacing only
// the final HTTP(S) shell operation with delivery to the connected web client.
module.exports=function installExternalLinks(shell,getClient,pack){
 const original=shell.openExternal.bind(shell);
 shell.openExternal=async(url,...args)=>{
  let parsed;try{parsed=new URL(url);}catch{return original(url,...args);}
  if(!['http:','https:'].includes(parsed.protocol))return original(url,...args);
  const client=getClient();
  if(client?.readyState!==1)throw Error('No Web UI client connected to open the link');
  client.send(pack({kind:'external-open',value:parsed.href}));
 };
};
