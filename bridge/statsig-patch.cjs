'use strict';
// Install the SDK's supported storageProvider option in the browser copy only.
// Match the options factory, not private module export IDs or experiment values.
module.exports=function statsigStorage(source){
 const factory=/(\b([\w$]+)=\{\.\.\.[\w$]+,enableLiveValuesAutoRefresh:!0,\.\.\.[\w$]+===!0\?\{\}:\{disableStorage:!0,loggingEnabled:`disabled`\}\};)(return \2\.networkConfig=)/g;
 let matches=0;
 const patched=source.replace(factory,(_match,prefix,options,suffix)=>{
  matches++;
  return `${prefix}if(!${options}.disableStorage&&globalThis.chatgptWebCreateStatsigStorage)${options}.storageProvider=globalThis.chatgptWebCreateStatsigStorage();${suffix}`;
 });
 if(matches!==1)throw Error(`Unsupported App: expected one Statsig options factory, found ${matches}`);
 return patched;
};
// The React SDK factory checks loadingStatus immediately after construction.
// Bootstrap here so it observes a ready client on the first render, using the
// same initializeSync API as the SDK's own bootstrap hook.
module.exports.clientFactory=function(source){
 const factory=/(\.useStatsigInternalClientFactoryAsync\)\(([\w$]+)=>)(new [\w$]+\.StatsigClient\(\2\.sdkKey,\2\.initialUser,\2\.statsigOptions\))/g;
 let count=0;
 const patched=source.replace(factory,(_match,prefix,options,expression)=>{
  count++;
  return `${prefix}(globalThis.chatgptWebInitializeStatsig??(client=>client))(${expression},${options}.statsigOptions)`;
 });
 if(count!==1)throw Error(`Unsupported App: expected one Statsig React client factory, found ${count}`);
 return patched;
};
