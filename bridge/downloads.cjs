'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
module.exports=function downloads(root,{send}){
 const pending=new Map(),files=new Map(),patches=[];
 function safeName(name){if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\/\\\x00-\x1f]/.test(name)||Buffer.byteLength(name)>240)throw Error('下载文件名无效');return name;}
 async function ready(destination){
  const entry=[...files.values()].find(v=>v.path===path.resolve(String(destination)));
  if(!entry||entry.ready)return;
  try{const stat=await fs.promises.stat(entry.path);if(!stat.isFile()||entry.ready)return;entry.ready=true;send({kind:'download-ready',value:{name:entry.name,url:'/bridge/download/'+entry.id}},entry.owner);}catch(error){console.error('[download]',error.message);}
 }
 return {
  open(options={},owner){const id=crypto.randomUUID();return new Promise(resolve=>{pending.set(id,{resolve,owner,extensions:(options.filters||[]).flatMap(f=>f.extensions||[])});send({kind:'save-open',value:{id,name:path.basename(options.defaultPath||'download.txt')}},owner);});},
  async choose(id,name){
   const choice=pending.get(id);if(!choice)throw Error('保存窗口已失效');
   if(name===null){pending.delete(id);choice.resolve({canceled:true,filePath:undefined});return;}
   safeName(name);
   const extensions=choice.extensions.filter(x=>x!=='*');
   if(extensions.length&&!extensions.includes(path.extname(name).slice(1).toLowerCase()))name+='.'+extensions[0];
   safeName(name);const directory=path.join(root,id);await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
   if(pending.get(id)!==choice)throw Error('保存窗口已关闭');
   const file=path.join(directory,name);files.set(id,{id,name,path:file,ready:false,owner:choice.owner});pending.delete(id);choice.resolve({canceled:false,filePath:file});
  },
  get(id){const file=files.get(id);return file?.ready?file:null;},
  cancel(){for(const value of pending.values())value.resolve({canceled:true,filePath:undefined});pending.clear();},
  install(){
   const wrap=(object,key,targetIndex)=>{const original=object[key];object[key]=async function(...args){const result=await original.apply(this,args);await ready(args[targetIndex]);return result;};patches.push(()=>{object[key]=original;});};
   for(const [key,index] of [['writeFile',0],['copyFile',1],['rename',1]])wrap(fs.promises,key,index);
   for(const [key,index] of [['writeFileSync',0],['copyFileSync',1],['renameSync',1]]){
    const original=fs[key];fs[key]=function(...args){const result=original.apply(this,args);void ready(args[index]);return result;};patches.push(()=>{fs[key]=original;});
   }
   const original=fs.createWriteStream;fs.createWriteStream=function(file,...args){const stream=original.call(this,file,...args);stream.once('close',()=>{if(stream.writableFinished&&!stream.errored)void ready(file);});return stream;};patches.push(()=>{fs.createWriteStream=original;});
   return ()=>{for(const restore of patches.reverse())restore();};
  },
 };
};
