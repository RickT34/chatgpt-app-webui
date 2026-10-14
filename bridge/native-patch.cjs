'use strict';
// Restrict this patch to the original runtime's file-content comparison helper.
// The caller still decides which files require verification and performs the
// original installation/repair if their digests differ.
function patch(source){
 if(!source.includes('chrome-plugin-app-server-runtime'))throw Error('Unsupported App: runtime validation module missing');
 const helper=/async function ([\w$]+)\(([\w$]+)\)\{return\(0,[\w$]+\.createHash\)\(`sha256`\)\.update\(await [\w$]+\.default\.readFile\(\2\)\)\.digest\(`hex`\)\}/g;
 let count=0;
 const result=source.replace(helper,(_match,name,file)=>{
  count++;
  return `async function ${name}(${file}){return require("./web-file-digest-cache.cjs").digest(${file})}`;
 });
 if(count!==1)throw Error(`Unsupported App: expected one runtime digest helper, found ${count}`);
 return result;
}
module.exports=patch;
if(require.main===module){
 try{process.stdout.write(patch(require('node:fs').readFileSync(0,'utf8')));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
