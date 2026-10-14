const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initialize}=require('../bridge/statsig-bootstrap.js');
const patch=require('../bridge/statsig-patch.cjs').clientFactory;
const now=1800000000000;
const user={userID:'user',customIDs:{stableID:'host-device',account_id:'account'},locale:'zh-CN',appVersion:'1',custom:{codex_app_session_id:'session',plan_type:'plus'}};
function fixture(){
 const record={sdkKey:'sdk',payload:JSON.stringify({has_updates:true,time:now-1000,user,feature_gates:{original:{value:true}},dynamic_configs:{},layer_configs:{}})};
 const client={loadingStatus:'Uninitialized',user:structuredClone(user),calls:[],getContext(){return {sdkKey:'sdk',user:this.user};},
  dataAdapter:{setData(value){client.calls.push('data');client.values=JSON.parse(value);}},
  initializeSync(options){this.calls.push('sync');assert.equal(options.disableBackgroundCacheRefresh,true);this.loadingStatus='Ready';},
  refreshValuesAsync(){this.calls.push('refresh');return Promise.resolve();}};
 return {client,record};
}
test('fresh matching host evaluations initialize before render and refresh after content',async()=>{
 const {client,record}=fixture();let refresh,marks=0;
 assert.equal(initialize(client,{},record,{now:()=>now,refresh:run=>{refresh=run;},mark:()=>marks++}),client);
 assert.equal(client.loadingStatus,'Ready');assert.deepEqual(client.values.feature_gates,{original:{value:true}});
 assert.deepEqual(client.calls,['data','sync']);assert.equal(marks,1);
 await refresh();assert.deepEqual(client.calls,['data','sync','refresh']);
 client.user.customIDs.account_id='another-account';await refresh();assert.equal(client.calls.length,3);
});
test('every identity attribute, SDK, freshness and privacy setting gates bootstrap reuse',()=>{
 for(const edit of [
  ({client})=>{client.user.userID='different';},
  ({client})=>{client.user.customIDs.account_id='different';},
  ({client})=>{client.user.customIDs.stableID='different';},
  ({client})=>{client.user.locale='en-US';},
  ({client})=>{client.user.appVersion='2';},
  ({client})=>{client.user.custom.codex_app_session_id='new';},
  ({client})=>{client.user.custom.plan_type='free';},
  ({record})=>{record.sdkKey='other';},
  ({record})=>{record.payload=record.payload.replace(String(now-1000),String(now-600001));},
  ({record})=>{record.payload=record.payload.replace(String(now-1000),String(now+1));},
  ({record})=>{record.payload='malformed';},
  ({record})=>{record.payload='{"has_updates":true}';},
  ({record})=>{const data=JSON.parse(record.payload);data.feature_gates=null;record.payload=JSON.stringify(data);},
  ({record})=>{record.payload=record.payload.replace('"has_updates":true','"has_updates":false');},
  data=>{data.options={disableStorage:true};},
 ]){
  const data=fixture();edit(data);initialize(data.client,data.options??{},data.record,{now:()=>now});
  assert.equal(data.client.loadingStatus,'Uninitialized');assert.deepEqual(data.client.calls,[]);
 }
 const {client,record}=fixture();client.user={...client.user,unused:undefined};
 initialize(client,{},record,{now:()=>now});assert.equal(client.loadingStatus,'Ready','undefined and object key order follow SDK JSON semantics');
});
test('client factory patch preserves construction and fails closed on incompatible packages',()=>{
 const source='function hook(user,options){return(0,react.useStatsigInternalClientFactoryAsync)(e=>new sdk.StatsigClient(e.sdkKey,e.initialUser,e.statsigOptions),{sdkKey:"sdk",initialUser:user,statsigOptions:options})}';
 const args=[];class StatsigClient{constructor(...values){args.push(values);}}
 const options={},react={useStatsigInternalClientFactoryAsync:(factory,input)=>factory(input)};
 const original=new Function('react','sdk','globalThis',patch(source)+';return hook;');
 const base=original(react,{StatsigClient},{})(user,options);assert(base instanceof StatsigClient);
 let initialized=0;
 const adapted=original(react,{StatsigClient},{chatgptWebInitializeStatsig:(client,received)=>{assert.equal(received,options);initialized++;return client;}})(user,options);
 assert(adapted instanceof StatsigClient);assert.equal(initialized,1);assert.equal(args.length,2);
 assert.deepEqual(args[0],['sdk',user,options]);
 assert.throws(()=>patch(source+source),/found 2/);assert.throws(()=>patch('changed SDK'),/found 0/);
});
test('browser refresh waits for real content and is canceled on page exit or startup failure',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const outcome of ['ready','pagehide','failed']){
  const {client,record}=fixture(),events=new EventTarget(),timers=new Map();let next=0;
  const context={Date:{now:()=>now},performance:{mark(){}},chatgptWebGetStatsigBootstrap:()=>record,chatgptWebStartup:{timings:[],failed:false},
   addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),
   setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('bridge/statsig-bootstrap.js','utf8'),context);
  context.chatgptWebInitializeStatsig(client,{});assert.deepEqual(client.calls,['data','sync']);
  events.dispatchEvent(new Event(outcome==='pagehide'?'pagehide':'chatgpt-web:'+outcome));
  if(outcome==='ready'){
   assert.equal(timers.size,1);const scheduled=[...timers.values()][0];assert.equal(scheduled.delay,1000);
   scheduled.callback();await Promise.resolve();await Promise.resolve();assert.deepEqual(client.calls,['data','sync','refresh']);
  }else{assert.equal(timers.size,0);assert.deepEqual(client.calls,['data','sync']);}
 }
});
