'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const zlib=require('node:zlib');
const {build}=require('../scripts/prepare-static.cjs');
const {renderPage,entryScript}=require('../bridge/page.cjs');
const createSender=require('../bridge/static.cjs');
const html='<html><head><meta http-equiv="Content-Security-Policy" content="script-src self; connect-src self;"><script type="module" crossorigin src="./assets/index.js"></script><link rel="modulepreload" crossorigin href="./assets/shared.js"><link rel="stylesheet" href="./assets/app.css"></head><body></body></html>';
const content={
 'assets/index.js':'import "./shared.js";const deps=["./initial.js"];await import(deps[0]);',
 'assets/shared.js':'const origin="app://fs";const text="a sentence mentioning app://fs";',
 'assets/initial.js':'export default "你好";'.repeat(1000),
 'assets/app.css':'body{color:red}',
 'assets/image.png':Buffer.from([0,255,2,3]),
 'bridge/rpc-client.mjs':'import "./capnweb.js";',
 'bridge/capnweb.js':'export const value=1;',
 'bridge/entry.js':entryScript(html),
};
async function fixture(run){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'chatgpt-static-'));
 const options={output,origin:'https://one.example',buildKey:'one',files:Object.keys(content),html,read:name=>Buffer.from(content[name])};
 try{await run(await build(options),options);}finally{fs.rmSync(output,{recursive:true,force:true});}
}
async function serving(output,manifest,run){
 const send=createSender.prepared(output,manifest);
 const server=http.createServer((req,res)=>send(req,res,req.url.slice(1),{immutable:!req.headers['x-unversioned']}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const request=(name,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/'+name,headers,method},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
  });req.on('error',reject);req.end();
 });
 try{await run(request);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('preparation rewrites exact origins, preloads startup chunks and reuses unchanged disk objects',()=>fixture(async(manifest,options)=>{
 const item=manifest.entries['assets/shared.js'];
 const body=fs.readFileSync(path.join(options.output,'objects',item.variants.identity.file)).toString();
 assert.match(body,/origin="https:\/\/one.example"/);assert.match(body,/sentence mentioning app:\/\/fs/);
 assert(manifest.preloads.includes('assets/initial.js'));assert(manifest.preloads.includes('bridge/rpc-client.mjs'));
 assert(!manifest.preloads.includes('assets/image.png'));
 const gzip=path.join(options.output,'objects',item.variants.gzip.file),mtime=fs.statSync(gzip).mtimeMs;
 const same=await build(options);assert.equal(same.version,manifest.version);assert.equal(fs.statSync(gzip).mtimeMs,mtime);
 const changed=await build({...options,origin:'https://two.example',buildKey:'two'});
 assert.notEqual(changed.version,manifest.version);assert.notEqual(changed.entries['assets/shared.js'].etag,item.etag);
 assert.equal(changed.entries['assets/initial.js'].etag,manifest.entries['assets/initial.js'].etag);
 const patched=await build({...options,read:name=>Buffer.from(name==='bridge/rpc-client.mjs'?'export const patched=true;':content[name])});
 assert.notEqual(patched.version,manifest.version,'adapter updates must not reuse immutable URLs');
}));
test('prepared HTTP streams exact variants, negotiates encodings and validates without body reads',()=>fixture(async(manifest,{output})=>{
 await serving(output,manifest,async request=>{
  const name='assets/initial.js',entry=manifest.entries[name];
  for(const format of ['identity','gzip','br']){
   const res=await request(name,{'accept-encoding':format});assert.equal(res.status,200);
   assert.equal(res.headers['cache-control'],'private, max-age=31536000, immutable');
   assert.deepEqual(format==='gzip'?zlib.gunzipSync(res.body):format==='br'?zlib.brotliDecompressSync(res.body):res.body,Buffer.from(content[name]));
   assert.equal(Number(res.headers['content-length']),res.body.length);
  }
  assert.equal((await request(name,{'x-unversioned':'1'})).headers['cache-control'],'private, no-cache');
  assert.equal((await request(name,{'accept-encoding':'br;q=0.2,gzip;q=0.8,identity;q=0'})).headers['content-encoding'],'gzip');
  assert.equal((await request(name,{'accept-encoding':'*;q=0'})).status,406);
  assert.equal((await request('assets/image.png',{'accept-encoding':'br,gzip'})).headers['content-encoding'],undefined);
  assert.equal((await request('__proto__')).status,404);
  // Removing the body proves 304/HEAD do not read or recompress it.
  fs.unlinkSync(path.join(output,'objects',entry.variants.br.file));
  const cached=await request(name,{'accept-encoding':'br','if-none-match':entry.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  const head=await request(name,{'accept-encoding':'br'},'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),entry.variants.br.size);
  assert.equal((await request(name,{'accept-encoding':'br'})).status,500);
 });
}));
test('HTML versions module graphs while preserving router base, CSP, and deferred script ordering',()=>fixture(async(manifest)=>{
 const startup='window.testStartup=true;';
 const page=renderPage(html,{startup,version:manifest.version,websocketOrigin:'wss://one.example',preloads:manifest.preloads});
 const prefix='/static/'+manifest.version+'/';
 assert(page.includes('<base href="/">'));assert(page.includes(`href="${prefix}assets/app.css"`));
 assert(page.includes(`href="${prefix}assets/initial.js"`));assert(page.includes(`href="${prefix}bridge/rpc-client.mjs"`));
 assert(page.includes(`defer src="${prefix}bridge/client.js"`));assert(page.includes(`type="module" src="${prefix}bridge/entry.js"`));
 assert(page.indexOf('bridge/client.js')<page.indexOf('bridge/entry.js'));
 assert(page.indexOf('Content-Security-Policy')<page.indexOf('assets/initial.js'));
 assert(page.includes(require('node:crypto').createHash('sha256').update(startup).digest('base64')));
 assert(page.includes('connect-src wss://one.example '));assert(!page.includes('unsafe-inline'));
 assert(entryScript(html).includes('import("../assets/index.js")'));
 assert(entryScript(html).indexOf('await window.chatgptWebReady')<entryScript(html).indexOf('import('));
}));

test('page identity escapes custom text, normalizes whitespace, and versions the local icon',()=>{
 const options={startup:'void 0;',version:'test-version',websocketOrigin:'ws://localhost'};
 const custom='  我的   工作台 & <script>"$&</script>\n';
 const page=renderPage(html.replace('</head>','<title>Old session title</title></head>'),{...options,title:custom});
 assert.equal((page.match(/<title>/g)||[]).length,1);
 assert(page.includes('<title>我的 工作台 &amp; &lt;script&gt;&quot;$&amp;&lt;/script&gt;</title>'));
 assert(!page.includes('Old session title'));
 assert(page.includes('href="/static/test-version/bridge/favicon.svg"'));
 assert(page.indexOf('bridge/identity.js')<page.indexOf('bridge/client.js'));
 assert(renderPage(html,{...options,title:' \n '}).includes('<title>ChatGPT Web</title>'));
});
