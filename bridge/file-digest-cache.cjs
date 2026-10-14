'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');

// The packaged runtime validates the same installed executables on every
// browser connection. Retain only digests, never file contents. Metadata is
// checked on every lookup and on the open file before and after reading.
function createCache({limit=128,open=fs.promises.open,stat=fs.promises.stat}={}){
 if(!Number.isSafeInteger(limit)||limit<1)throw RangeError('Digest cache limit must be a positive integer');
 const entries=new Map();
 const signature=value=>[value.dev,value.ino,value.mode,value.size,value.mtimeNs,value.ctimeNs].join(':');
 return async function digest(file){
  file=path.resolve(file);
  const info=await stat(file,{bigint:true}),key=signature(info);
  const previous=entries.get(file);
  if(previous?.key===key){entries.delete(file);entries.set(file,previous);return previous.promise;}
  const entry={key,promise:null};
  entry.promise=(async()=>{
   const handle=await open(file,'r');
   try{
    const before=await handle.stat({bigint:true}),hash=crypto.createHash('sha256');
    // FileHandle streams keep reads bounded and yield between chunks, avoiding
    // a large readFile buffer and a long synchronous hash in Electron main.
    for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
    const after=await handle.stat({bigint:true});
    if(signature(before)!==key||signature(after)!==key){
     if(entries.get(file)===entry)entries.delete(file);
    }
    return hash.digest('hex');
   }finally{await handle.close();}
  })().catch(error=>{if(entries.get(file)===entry)entries.delete(file);throw error;});
  entries.set(file,entry);
  while(entries.size>limit)entries.delete(entries.keys().next().value);
  return entry.promise;
 };
}
module.exports={createCache,digest:createCache()};
