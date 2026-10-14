'use strict';
window.chatgptWebNative=function(call){
 let closePrompt=()=>{};
 function dialog(title){
  closePrompt();
  const previous=document.activeElement;
  const owner=previous?.closest('[role="dialog"],dialog[open]') || Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).findLast(el=>el.getClientRects().length);
  const element=document.createElement('dialog');element.className='host-folder-picker';element.setAttribute('aria-label',title);
  const heading=document.createElement('h2');heading.textContent=title;element.append(heading);
  for(const event of ['click','pointerdown','pointerup','focusin','focusout'])element.addEventListener(event,e=>e.stopPropagation());
  (owner||document.body).append(element);
  let canceled=()=>{},done=false;
  const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();canceled();}};
  window.addEventListener('keydown',escape,true);element.oncancel=e=>{e.preventDefault();canceled();};
  const close=()=>{if(done)return;done=true;window.removeEventListener('keydown',escape,true);element.close();element.remove();if(previous?.isConnected)previous.focus();};
  const dismiss=button('×',()=>{if(!done)canceled();});dismiss.className='web-dialog-close';dismiss.setAttribute('aria-label','关闭');element.append(dismiss);
  closePrompt=()=>{if(!done)canceled();};
  return {element,close,setCancel:fn=>{canceled=fn;},show:()=>element.showModal()};
 }
 function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;return b;}
 async function writeText(text){
  text=String(text);
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}}catch{}
  // A fresh click supplies user activation on browsers which require it.
  return new Promise((resolve,reject)=>{
   const view=dialog('复制到客户端剪贴板'),message=document.createElement('p'),input=document.createElement('textarea'),footer=document.createElement('footer');
   message.textContent='浏览器需要你点击确认后才能复制。';input.value=text;input.readOnly=true;input.style.cssText='width:100%;height:150px';input.setAttribute('aria-label','待复制的文字');
   const cancel=()=>{view.close();reject(Error('复制已取消'));};view.setCancel(cancel);
   footer.append(button('取消',cancel),button('复制',async()=>{
    try{
     if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
     else{input.focus();input.select();if(!document.execCommand('copy'))throw Error('浏览器不允许写入剪贴板，请使用 HTTPS 或 localhost');}
     view.close();resolve();
    }catch(error){message.textContent=error.message;}
   }));view.element.append(message,input,footer);view.show();
  });
 }
 function save(request){
  const view=dialog('保存到客户端'),input=document.createElement('input'),message=document.createElement('p'),footer=document.createElement('footer');
  input.value=request.name;input.setAttribute('aria-label','下载文件名');input.style.cssText='width:100%;padding:10px';message.textContent='文件生成后将在此浏览器下载。';
  const cancel=()=>{void call('download.choose',request.id,null).catch(()=>{});view.close();};view.setCancel(cancel);
  footer.append(button('取消',cancel),button('下载',async()=>{try{await call('download.choose',request.id,input.value);view.close();}catch(error){message.textContent=error.message;}}));
  view.element.append(message,input,footer);view.show();input.focus();input.select();
 }
 function ready(file){
  const box=document.createElement('div');box.className='web-download-notice';box.setAttribute('role','status');
  const link=document.createElement('a');link.href=file.url;link.download=file.name;link.textContent='下载 '+file.name;
  const label=document.createElement('span');label.textContent='文件已就绪：';box.append(label,link,button('关闭',()=>box.remove()));document.body.append(box);
  // Keep the link visible when the browser blocks automatic downloads.
  link.click();
 }
 return {clipboard:{writeText,async readText(){if(!navigator.clipboard?.readText)throw Error('浏览器不支持读取客户端剪贴板');return navigator.clipboard.readText();}},save,ready,close:()=>closePrompt()};
};
