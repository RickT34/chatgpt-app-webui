'use strict';
window.chatgptWebFolderPicker=function(call){
 let closeCurrent=()=>{};
 function open(request){
  closeCurrent();
  const previousFocus=document.activeElement;
  // Keep the picker inside the original dialog's DOM/focus boundary. A sibling
  // on document.body is treated by Radix as an outside click and dismisses it.
  const owner=previousFocus?.closest('[role="dialog"],dialog[open]') ||
    Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).findLast(el=>el.getClientRects().length>0);
  const modal=document.createElement('dialog');modal.className='host-folder-picker';
  modal.setAttribute('aria-label','选择宿主机文件夹');
  for(const type of ['pointerdown','pointerup','click','focusin','focusout'])modal.addEventListener(type,event=>event.stopPropagation());
  const onEscape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void cancel();}};
  window.addEventListener('keydown',onEscape,true);
  modal.innerHTML=`<button type="button" class="web-dialog-close" data-action="close" aria-label="关闭">×</button><form class="folder-path-form"><h2>选择项目文件夹</h2><p>浏览运行 App 的宿主机文件系统</p><div class="folder-toolbar"><button type="button" data-action="home">主目录</button><button type="button" data-action="up">上一级</button><input aria-label="宿主机文件夹路径" required><button type="submit">前往</button></div></form><label class="folder-hidden"><input type="checkbox"> 显示隐藏文件夹</label><p class="folder-status" role="status"></p><div class="folder-list" aria-label="宿主机文件夹列表"></div><footer><button type="button" data-action="cancel">取消</button><button type="button" data-action="select">选择此文件夹</button></footer>`;
  const input=modal.querySelector('input[required]'), hidden=modal.querySelector('input[type=checkbox]'), list=modal.querySelector('.folder-list'),status=modal.querySelector('.folder-status');
  const select=modal.querySelector('[data-action=select]'),up=modal.querySelector('[data-action=up]');
  let current=request.initialPath,parent=request.home,revision=0,closed=false;
  function dispose(){
   if(closed)return;closed=true;revision++;
   window.removeEventListener('keydown',onEscape,true);
   modal.close();modal.remove();
   if(previousFocus?.isConnected)previousFocus.focus();
  }
  closeCurrent=dispose;
  async function cancel(){if(closed)return;dispose();await call('folder.cancel',request.id).catch(()=>{});}
  async function load(target){
   const version=++revision;select.disabled=true;status.textContent='正在读取文件夹…';
   try{
    const data=await call('folder.list',request.id,target,hidden.checked);
    if(closed||version!==revision)return;
    current=data.path;parent=data.parent;input.value=current;up.disabled=parent===current;
    list.replaceChildren();
    for(const entry of data.directories){const button=document.createElement('button');button.type='button';button.textContent='📁 '+entry.name;button.addEventListener('click',()=>load(entry.path));list.append(button);}
    status.textContent=data.directories.length?`${data.directories.length} 个文件夹`:'此目录没有可显示的子文件夹';select.disabled=false;
   }catch(error){if(!closed&&version===revision)status.textContent='无法打开：'+error.message;}
  }
  modal.querySelector('form').onsubmit=event=>{event.preventDefault();load(input.value);};
  modal.querySelector('[data-action=home]').onclick=()=>load(request.home);
  up.onclick=()=>load(parent);hidden.onchange=()=>load(current);
  modal.querySelector('[data-action=cancel]').onclick=()=>{void cancel();};
  modal.querySelector('[data-action=close]').onclick=()=>{void cancel();};
  modal.oncancel=event=>{event.preventDefault();void cancel();};
  select.onclick=async()=>{
   select.disabled=true;
   try{await call('folder.select',request.id,current);dispose();}
   catch(error){status.textContent=error.message;select.disabled=false;}
  };
  (owner || document.body).append(modal);modal.showModal();input.value=current;void load(current);
 }
 return {open,close:()=>closeCurrent()};
};
