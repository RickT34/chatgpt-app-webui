const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStorage}=require('../bridge/statsig-storage.js');
const patch=require('../bridge/statsig-patch.cjs');
function localStorage(){
 const storage=Object.create(null);
 Object.defineProperties(storage,{
  getItem:{value:key=>storage[key]??null},
  setItem:{value:(key,value)=>{if(value.length>5000000)throw new DOMException('Full','QuotaExceededError');storage[key]=value;}},
  removeItem:{value:key=>{delete storage[key];}},
 });
 return storage;
}
test('large SDK evaluations survive a new provider without consuming localStorage quota',async()=>{
 let disk=[];const persistence={load:async()=>disk,save:async rows=>{disk=structuredClone(rows);}};
 const local=localStorage(),first=createStorage(local,persistence),key='statsig.cached.evaluations.user';
 await first.isReadyResolver();
 const value='x'.repeat(5400000);
 first.setItem('statsig.stable_id','existing-id');first.setItem(key,value);
 const second=createStorage(local,persistence);await second.isReadyResolver();
 assert.equal(second.isReady(),true);assert.equal(second.getItem(key),value);
 assert.equal(local.getItem(key),null);assert.equal(second.getItem('statsig.stable_id'),'existing-id');
 assert(second.getAllKeys().includes(key));
 second.removeItem(key);
 const third=createStorage(local,persistence);await third.isReadyResolver();
 assert.equal(third.getItem(key),null);assert.equal(third.getItem('statsig.stable_id'),'existing-id');
});
test('writes and removals during cache loading win over the older stored values',async()=>{
 const loading=Promise.withResolvers();let saved;
 const storage=createStorage(localStorage(),{load:()=>loading.promise,save:async rows=>{saved=rows;}});
 storage.setItem('statsig.cached.current','new');storage.removeItem('statsig.cached.removed');
 loading.resolve([['statsig.cached.current','old'],['statsig.cached.removed','old'],['unrelated','ignored']]);
 await storage.isReadyResolver();
 assert.deepEqual(saved,[['statsig.cached.current','new']]);
 assert.equal(storage.getItem('statsig.cached.current'),'new');assert.equal(storage.getItem('statsig.cached.removed'),null);
});
test('cache failures leave startup usable and memory retention is bounded',async()=>{
 let warnings=0;
 const storage=createStorage(localStorage(),{load:async()=>{throw Error('blocked');},save:async()=>{throw Error('full');}},
  {warn:()=>warnings++,maxEntries:1});
 await storage.isReadyResolver();
 storage.setItem('statsig.cached.old','old');storage.setItem('statsig.cached.new','new');
 await Promise.resolve();
 assert.equal(storage.isReady(),true);assert.equal(warnings,1);assert.equal(storage.getItem('statsig.cached.old'),null);
 assert.equal(storage.getItem('statsig.cached.new'),'new');
 const bounded=createStorage(localStorage(),{load:async()=>[],save:async()=>{}},{maxBytes:128});
 await bounded.isReadyResolver();bounded.setItem('statsig.cached.large','x'.repeat(100));
 assert.equal(bounded.getItem('statsig.cached.large'),null);
});
test('SDK option injection preserves network behavior and disabled storage',()=>{
 const source='function options(enabled){let config={...defaults,enableLiveValuesAutoRefresh:!0,...enabled===!0?{}:{disableStorage:!0,loggingEnabled:`disabled`}};return config.networkConfig={...defaults.networkConfig,preventAllNetworkTraffic:!1},config}';
 const provider={},defaults={networkConfig:{api:'https://example.invalid'}};let opened=0;
 const options=new Function('globalThis','defaults',patch(source)+';return options;')({chatgptWebCreateStatsigStorage:()=>{opened++;return provider;}},defaults);
 assert.equal(options(false).storageProvider,undefined);assert.equal(opened,0,'disabled storage must not open the cache');
 assert.equal(options(true).storageProvider,provider);assert.equal(options(false).storageProvider,undefined);
 assert.equal(options(false).disableStorage,true);assert.equal(options(false).loggingEnabled,'disabled');
 assert.deepEqual(options(true).networkConfig,{api:'https://example.invalid',preventAllNetworkTraffic:false});
 assert.throws(()=>patch('different SDK'),/expected one Statsig options factory/);
 assert.throws(()=>patch(source+source),/found 2/);
});
