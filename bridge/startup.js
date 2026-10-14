(function(root){
 'use strict';
 function wait(promise,ms,message,onTimeout=()=>{}){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error(message);error.name='TimeoutError';reject(error);onTimeout();},ms);})]).finally(()=>clearTimeout(timer));
 }
 async function bootstrap(fetcher,{timeout=180000,requestTimeout=10000,retry=1000}={}){
  const end=Date.now()+timeout;let lastError=null;
  while(Date.now()<end){
   const controller=new AbortController();
   let response;
   try{
    response=await wait(fetcher('/bridge/bootstrap',{signal:controller.signal,cache:'no-store',credentials:'same-origin',priority:'high'}),Math.min(requestTimeout,end-Date.now()),'获取 App 状态超时，请检查网络或反向代理。',()=>controller.abort());
    if(response.ok)return await wait(response.json(),Math.max(1,Math.min(requestTimeout,end-Date.now())),'读取 App 状态超时，请检查网络或反向代理。',()=>controller.abort());
    lastError=null;
   }catch(error){
    if(!['TimeoutError','AbortError','TypeError'].includes(error?.name))throw error;
    lastError=error;
   }
   if(response&&!response.ok){
    if(response.status===401||response.status===403)throw Error(`登录已过期或访问验证失败（HTTP ${response.status}），请重新登录反向代理或打开服务输出的登录链接。`);
    if(![502,503,504].includes(response.status))throw Error(`获取 App 状态失败（HTTP ${response.status}）。`);
    if(response.status!==503)lastError=Error(`网关暂不可用（HTTP ${response.status}）。`);
    void response.body?.cancel().catch(()=>{});
   }
   await new Promise(resolve=>setTimeout(resolve,Math.min(retry,Math.max(0,end-Date.now()))));
  }
  throw lastError?Error(`获取 App 状态超时，请检查网络或反向代理后重试。${lastError.name==='TimeoutError'?'':`（${lastError.message}）`}`):Error('宿主 App 未就绪，请检查宿主进程后重试。');
 }
 function connect(ws,timeout=15000){
  return new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);ws.removeEventListener('open',opened);ws.removeEventListener('error',failed);ws.removeEventListener('close',failed);if(error){ws.close();reject(error);}else resolve(ws);};
   const opened=()=>finish(),failed=()=>finish(Error('连接失败，请关闭其他已连接页面，并检查登录状态、访问地址和反向代理。'));
   const timer=setTimeout(()=>finish(Error('连接宿主机超时，请检查网络后重试。')),timeout);
   ws.addEventListener('open',opened);ws.addEventListener('error',failed);ws.addEventListener('close',failed);
  });
 }
 async function acquire({fetcher,makeSocket,confirm,connecting=()=>{}}){
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
   const controller=new AbortController();
   const state=await wait((async()=>{
    const response=await fetcher('/bridge/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(response.status===401||response.status===403)throw Error('登录已过期，请重新登录后重试。');
    if(!response.ok)throw Error(`读取连接状态失败（HTTP ${response.status}）。`);
    return response.json();
   })(),10000,'读取连接状态超时。',()=>controller.abort());
   if(state.browser&&!state.clientId)throw Error('服务版本不支持接管，请更新并重启服务。');
   if(state.browser)await confirm();
   connecting();
   const socket=makeSocket('/bridge/socket'+(state.browser?'?takeover='+encodeURIComponent(state.clientId):''));
   try{return await connect(socket);}catch(error){lastError=error;}
  }
  throw lastError;
 }
 function status(){
  // This inline script precedes the large module preloads and deferred bridge
  // scripts. Start the small authenticated request before those occupy sockets.
  const bootstrapReady=bootstrap(fetch);bootstrapReady.catch(()=>{});
  const started=performance.now(),timings=[];
  const mark=phase=>{const ms=Math.round(performance.now()-started);timings.push({phase,ms});performance.mark?.(`chatgpt-web:${phase}`);};
  let panel,label,button,timer,failed=false,finished=false,hostReady=false,entryReady=false,contentReady=false,stage='下载页面资源',confirmation=null;
  const clean=()=>{clearTimeout(timer);};
  const paint=()=>{
   if(!panel){
    panel=document.createElement('div');panel.setAttribute('role','status');
    panel.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:90vw;padding:16px;background:#202124;color:#fff;border:1px solid #777;border-radius:10px;font:14px sans-serif;white-space:pre-wrap';
    label=document.createElement('div');button=document.createElement('button');button.textContent='重新加载';button.style.cssText='margin-top:12px;padding:6px 12px;cursor:pointer';button.onclick=()=>location.reload();panel.append(label,button);(document.body||document.documentElement).append(panel);
   }
   label.textContent=failed||confirmation?stage:`正在${stage}…`;button.hidden=!failed&&!confirmation;
   button.textContent=confirmation?'接管连接':'重新加载';
   button.onclick=()=>{if(confirmation){const {resolve}=confirmation;confirmation=null;button.hidden=true;resolve();}else location.reload();};
  };
  const fail=error=>{if(failed)return;confirmation?.reject(error);confirmation=null;failed=true;finished=false;clean();stage=`${stage}失败：${error?.message||String(error)}`;paint();window.dispatchEvent(new Event('chatgpt-web:failed'));};
  const setStage=(value,ms=120000)=>{if(failed||finished)return;stage=value;mark(value);clearTimeout(timer);timer=setTimeout(()=>fail(Error('等待超时，可以重试；若反复出现，请检查宿主 App 日志。')),ms);paint();};
  const confirmTakeover=()=>{if(failed)return Promise.reject(Error('启动已中止，请重试。'));clean();stage='已有其他页面连接。接管后旧页面将断开，正在运行的后端任务不会主动停止。';return new Promise((resolve,reject)=>{confirmation={resolve,reject};paint();});};
  const check=()=>{
   if(!failed&&!finished&&hostReady&&entryReady&&contentReady){finished=true;mark('ready');clean();panel?.remove();panel=null;window.dispatchEvent(new Event('chatgpt-web:ready'));console.info('[chatgpt-web] startup timings (ms)',timings);}
  };
  document.addEventListener('DOMContentLoaded',()=>{if(!failed&&!finished)paint();},{once:true});
  window.addEventListener('error',event=>{
   if(finished||failed)return;
   const tag=event.target?.tagName;
   if(tag==='SCRIPT'||tag==='LINK'){
    let resource='未知资源';
    try{resource=new URL(event.target.src||event.target.href,location.href).pathname;}catch{}
    setStage('下载页面资源');
    fail(Error(`页面资源下载失败（${tag}：${resource}），请检查网络、反向代理或刷新页面后重试。`));
   }
   else if(event.target===window)fail(Error('页面初始化异常，请重试；详细错误见浏览器控制台。'));
  },true);
  window.addEventListener('unhandledrejection',()=>{if(!finished&&!failed)fail(Error('页面初始化异常，请重试；详细错误见浏览器控制台。'));});
  setStage(stage);
  return {wait,bootstrap,bootstrapReady,connect,acquire,confirmTakeover,stage:setStage,fail,get timings(){return timings.map(value=>({...value}));},get failed(){return failed;},hostReady(){hostReady=true;mark('host_ready');setStage('初始化界面');check();},entryReady(){entryReady=true;mark('entry_ready');check();},phase(value){if(value==='first_content_visible'&&!contentReady){contentReady=true;mark(value);check();}}};
 }
 const api={wait,bootstrap,connect,acquire};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.chatgptWebStartup=status();
})(typeof window==='undefined'?globalThis:window);
