'use strict';
// Starts/stops the generated App for each mode. Stop your normal instance first.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const crypto=require('node:crypto');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function verify(mode){
 const env={...process.env,CHATGPT_WEB_PORT:'19876',CHATGPT_WEB_AUTH:mode==='none'?'none':'token'};
 delete env.CHATGPT_WEB_ACCESS_TOKEN;delete env.CHATGPT_WEB_ORIGIN;
 if(mode==='custom')env.CHATGPT_WEB_ACCESS_TOKEN=crypto.randomBytes(24).toString('hex');
 const log=fs.openSync(`.logs/verify-${mode}.log`,'w',0o600);
 const child=spawn('scripts/start',['--ozone-platform=headless','--disable-gpu'],{env,detached:true,stdio:['ignore',log,log]});fs.closeSync(log);
 try{
  let ready=false;
  for(let i=0;i<200;i++){
   if(child.exitCode!==null)throw Error(`App exited (${child.exitCode}); see .logs/verify-${mode}.log`);
   try{await fetch('http://127.0.0.1:19876/');ready=true;break;}catch{await pause(100);}
  }
  assert(ready,'App did not listen');
  const base='http://127.0.0.1:19876';
  const response=await fetch(base);assert.equal(response.status,mode==='none'?200:401);
  let cookie='';const url=fs.readFileSync('.logs/access-url','utf8').trim();
  if(mode==='none')assert.equal(url,base+'/');
  else{
   if(mode==='custom')assert.equal(new URL(url).searchParams.get('token'),env.CHATGPT_WEB_ACCESS_TOKEN);
   const login=await fetch(url,{redirect:'manual'});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
   assert.equal((await fetch(base+'/login?token=incorrect')).status,401);
  }
  assert.equal((await fetch(base,{headers:{cookie}})).status,200);
  const html=await (await fetch(base,{headers:{cookie}})).text();assert.match(html,/bridge\/entry.js/);
  const denied=new WebSocket(base.replace('http','ws')+'/bridge/socket',{headers:{cookie,origin:'https://not-allowed.example'}});
  const deniedResult=await new Promise((resolve,reject)=>{denied.on('unexpected-response',(_r,res)=>{res.resume();resolve(res.statusCode);});denied.on('open',()=>reject(Error('Foreign origin accepted')));denied.on('error',reject);});assert.equal(deniedResult,403);
  const ws=new WebSocket(base.replace('http','ws')+'/bridge/socket',{headers:{cookie,origin:base}});await once(ws,'open');ws.close();await once(ws,'close');
  console.log(`PASS: packaged App ${mode} mode, HTML, login and WebSocket Origin`);
 }finally{
  try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  if(child.exitCode===null&&child.signalCode===null){const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},10000);await once(child,'exit');clearTimeout(timer);}
  let unlocked=false;for(let i=0;i<100;i++){if(spawnSync('flock',['-n','.logs/instance.lock','true']).status===0){unlocked=true;break;}await pause(100);}
  if(!unlocked)throw Error('App descendants did not release the runtime lock');
 }
}
(async()=>{for(const mode of ['random','custom','none'])await verify(mode);})().catch(e=>{console.error(e);process.exitCode=1;});
