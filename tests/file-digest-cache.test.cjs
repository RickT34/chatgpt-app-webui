const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createCache}=require('../bridge/file-digest-cache.cjs');
const patch=require('../bridge/native-patch.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');

test('unchanged files share one digest, while edits, replacements and deletions invalidate it',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'digest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'tool');await fs.writeFile(file,Buffer.alloc(2*1024*1024,17));
 let reads=0;const digest=createCache({open:async(...args)=>{reads++;return fs.open(...args);}});
 const values=await Promise.all([digest(file),digest(file),digest(file)]);
 assert.equal(new Set(values).size,1);assert.equal(values[0],hash(await fs.readFile(file)));assert.equal(reads,1);
 assert.equal(await digest(file),values[0]);assert.equal(reads,1);
 const original=await fs.stat(file);
 await fs.writeFile(file,Buffer.alloc(2*1024*1024,18));await fs.utimes(file,original.atime,original.mtime);
 assert.notEqual(await digest(file),values[0]);assert.equal(reads,2,'ctime detects edits even when mtime is restored');
 const replacement=path.join(dir,'replacement');await fs.writeFile(replacement,Buffer.alloc(2*1024*1024,19));
 await fs.rename(replacement,file);assert.equal(await digest(file),hash(Buffer.alloc(2*1024*1024,19)));assert.equal(reads,3);
 await fs.unlink(file);await assert.rejects(digest(file),{code:'ENOENT'});
});

test('failed or changing reads are retried and cache retention is bounded',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'digest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files=await Promise.all(['one','two','three'].map(async name=>{const file=path.join(dir,name);await fs.writeFile(file,name);return file;}));
 let reads=0,fail=true,change=false;
 const digest=createCache({limit:2,open:async(...args)=>{
  reads++;if(fail){fail=false;throw Error('read failed');}
  if(change){change=false;await fs.appendFile(args[0],'changed');}
  return fs.open(...args);
 }});
 await assert.rejects(digest(files[0]),/read failed/);
 assert.equal(await digest(files[0]),hash('one'));assert.equal(reads,2);
 await digest(files[1]);await digest(files[2]);await digest(files[0]);assert.equal(reads,5);
 await fs.appendFile(files[0],'x');change=true;
 assert.equal(await digest(files[0]),hash('onexchanged'));
 await digest(files[0]);assert.equal(reads,7,'a changed read must not be cached');
});

test('native patch only replaces the unique runtime file digest helper',()=>{
 const source='const category=`chrome-plugin-app-server-runtime`;async function digest(file){return(0,crypto.createHash)(`sha256`).update(await fs.default.readFile(file)).digest(`hex`)}';
 const patched=patch(source);let received;
 const digest=new Function('require',patched+';return digest;')(()=>({digest:file=>{received=file;return 'hash';}}));
 return digest('/tool').then(value=>{
  assert.equal(value,'hash');assert.equal(received,'/tool');
  assert.throws(()=>patch(source+source),/found 2/);
  assert.throws(()=>patch('changed official runtime'),/module missing/);
 });
});
