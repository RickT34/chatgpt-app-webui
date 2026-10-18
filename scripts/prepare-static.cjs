'use strict';
// Runs under the setup lock, outside Electron. Content-addressed objects reuse
// compression across adapter/origin updates; only the manifest is published last.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {promisify}=require('node:util');
const {entryPath,entryScript}=require('../bridge/page.cjs');
const gzip=promisify(zlib.gzip),brotli=promisify(zlib.brotliCompress);
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.pdf':'application/pdf','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.wasm':'application/wasm'};

function openArchive(file){
 const fd=fs.openSync(file,'r');
 const read=(offset,size)=>{const buffer=Buffer.alloc(size);let done=0;while(done<size){const n=fs.readSync(fd,buffer,done,size-done,offset+done);if(!n)throw Error('Truncated ASAR');done+=n;}return buffer;};
 try{
  const prefix=read(0,16),base=8+prefix.readUInt32LE(4),header=JSON.parse(read(16,prefix.readUInt32LE(12)));
  const files=new Map();
  function walk(node,relative=''){
   for(const [name,entry] of Object.entries(node.files)){
    if(entry.files)walk(entry,relative+name+'/');
    else if(entry.offset!==undefined&&!entry.unpacked)files.set(relative+name,entry);
   }
  }
  walk(header.files.webview);
  return {files,read:name=>{const entry=files.get(name);if(!entry)throw Error(`Missing web asset: ${name}`);return read(base+Number(entry.offset),entry.size);},close:()=>fs.closeSync(fd)};
 }catch(error){fs.closeSync(fd);throw error;}
}

async function build({output,origin,buildKey,files,read,html}){
 const objects=path.join(output,'objects');fs.mkdirSync(objects,{recursive:true});
 const entries={};
 for(const name of files){
  let data=await read(name);
  if(/\.m?js$/.test(name)&&!name.startsWith('bridge/')){
   let source=require('../bridge/link-labels.cjs')(data.toString(),name);
   if(/^assets\/app-initial-[\w-]+\.js$/.test(name))source=require('../bridge/statsig-patch.cjs')(source);
   if(/^assets\/app-shared-[\w-]+\.js$/.test(name))source=require('../bridge/statsig-patch.cjs').clientFactory(source);
   if(source.includes('app://fs'))source=source.replace(/(["'`])app:\/\/fs\1/g,JSON.stringify(origin));
   data=Buffer.from(source);
  }
  const digest=hash(data),type=mime[path.extname(name)]||'application/octet-stream';
  const variants={identity:{file:digest,size:data.length}};
  const write=(file,body)=>{const target=path.join(objects,file);if(!fs.existsSync(target)){fs.writeFileSync(target+'.tmp',body);fs.renameSync(target+'.tmp',target);}};
  write(digest,data);
  if(/^(text\/|application\/(?:javascript|json|wasm)|image\/svg\+xml)/.test(type)){
   for(const format of ['gzip','br']){
    const file=digest+'.'+format,target=path.join(objects,file);
    if(!fs.existsSync(target))write(file,await (format==='br'?brotli(data,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}}):gzip(data,{level:6})));
    variants[format]={file,size:fs.statSync(target).size};
   }
  }
  entries[name]={etag:`W/"${digest}"`,type,variants};
 }
 const entry=entryPath(html).slice(1),source=(await read(entry)).toString();
 const preloads=new Set([entry,'bridge/rpc-client.mjs','bridge/capnweb.js']);
 // The small original entry lists its startup chunks (including dynamic imports).
 // Do not recursively preload the entire application or optional feature chunks.
 for(const match of source.matchAll(/["'`](\.\/[^"'`]+\.m?js)["'`]/g)){
  const name=path.posix.join(path.posix.dirname(entry),match[1]);
  if(entries[name])preloads.add(name);
 }
 const version=hash(JSON.stringify({buildKey,entries,preloads:[...preloads]}));
 const manifest={buildKey,version,preloads:[...preloads],entries};
 fs.writeFileSync(path.join(output,'manifest.json.tmp'),JSON.stringify(manifest));
 fs.renameSync(path.join(output,'manifest.json.tmp'),path.join(output,'manifest.json'));
 const keep=new Set(Object.values(entries).flatMap(entry=>Object.values(entry.variants).map(v=>v.file)));
 for(const file of fs.readdirSync(objects))if(/^[a-f0-9]{64}(?:\.(?:br|gzip))?$/.test(file)&&!keep.has(file))fs.unlinkSync(path.join(objects,file));
 return manifest;
}

async function main(){
 const root=path.resolve(__dirname,'..'),output=path.join(root,'.runtime/web-static');
 const prepared=JSON.parse(fs.readFileSync(path.join(root,'prepare-manifest.json')));
 const {origin}=require('../bridge/access.cjs')();
 const buildKey=hash(JSON.stringify({source:prepared.source_sha256,patches:prepared.patch_files,origin}));
 let cached;try{cached=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));}catch{}
 const ready=cached?.buildKey===buildKey&&fs.existsSync(path.join(output,'objects'));
 if(process.argv.includes('--check')){if(!ready)throw Error('Static resources are missing or stale; run scripts/start.sh to prepare them');return;}
 if(ready)return;
 console.log('Preparing versioned web resources (one-time compression)...');
 // Host index.html may be a minimal relay document. Web resources always come
 // from the original package; bridge files are added separately below.
 const archive=openArchive(prepared.source);
 try{
  const html=archive.read('index.html').toString();
  const bridge=new Map(['identity.js','favicon.svg','codec.js','statsig-storage.js','statsig-bootstrap.js','folder-picker.css','folder-picker.js','attachments.js','resources.js','browser-native.js','browser-view.js','client.js','rpc-client.mjs'].map(name=>['bridge/'+name,()=>fs.readFileSync(path.join(root,'bridge',name))]));
  bridge.set('bridge/capnweb.js',()=>fs.readFileSync(path.join(root,'node_modules/capnweb/dist/index.js')));
  bridge.set('bridge/entry.js',()=>Buffer.from(entryScript(html)));
  const files=[...archive.files.keys(),...bridge.keys()].filter(name=>name!=='index.html');
  const manifest=await build({output,origin,buildKey,files,html,read:name=>bridge.has(name)?bridge.get(name)():archive.read(name)});
  console.log(`Prepared ${Object.keys(manifest.entries).length} web resources; version ${manifest.version.slice(0,12)}`);
 }finally{archive.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build,openArchive};
