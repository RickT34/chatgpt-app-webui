'use strict';
window.chatgptWebAttachments=function(call){
 const filePaths=new WeakMap(),replayed=new WeakSet(),controllers=new Set();
 let closeCurrent=()=>{},connected=true,statusTimer;
 function notice(text,autoHide=false,notification={dismissed:false}){
  if(notification.dismissed)return;
  clearTimeout(statusTimer);
  let box=document.getElementById('web-upload-status');
  if(!box){box=document.createElement('div');box.id='web-upload-status';box.setAttribute('role','status');document.body.append(box);}
  box.replaceChildren();const label=document.createElement('span');label.textContent=text;const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=()=>{notification.dismissed=true;box.remove();};box.append(label,close);
  if(autoHide){statusTimer=setTimeout(()=>box.remove(),6000);statusTimer?.unref?.();}
  return box;
 }
 async function discard(records){if(records.length&&connected)await call('upload.discard',records.map(x=>x.id)).catch(()=>{});}
 async function upload(file,signal,group){
  if(file.size>32*1024*1024)throw Error(`${file.name} 超过 32 MiB，无法上传`);
  const response=await fetch('/bridge/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Upload-Name':encodeURIComponent(file.name),'X-Chatgpt-Web-Upload':'1','X-Upload-Group':group},body:file,signal});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'上传失败');
  return result;
 }
 function open(request){
  closeCurrent();
  const previousFocus=document.activeElement;
  const owner=previousFocus?.closest('[role="dialog"],dialog[open]') || Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).findLast(el=>el.getClientRects().length>0);
  const modal=document.createElement('dialog');modal.className='host-folder-picker web-file-picker';modal.setAttribute('aria-label','选择附件来源');
  modal.innerHTML=`<button type="button" class="web-dialog-close" data-action="close" aria-label="关闭">×</button><h2>添加附件</h2><div class="file-source-tabs"><button type="button" data-source="client" aria-pressed="true">客户端文件</button><button type="button" data-source="host" aria-pressed="false">宿主机文件</button></div><section data-panel="client"><p>选择当前浏览器所在设备的文件，上传到宿主机后添加到对话。每个文件最多 32 MiB。</p><button type="button" data-action="choose">选择客户端文件</button><input type="file" hidden><div class="client-file-list"></div></section><section data-panel="host" hidden><p>选择运行 App 的宿主机上的文件。</p><form class="folder-toolbar"><button type="button" data-action="home">主目录</button><button type="button" data-action="up">上一级</button><input aria-label="宿主机附件目录" required><button type="submit">前往</button></form><label class="folder-hidden"><input type="checkbox"> 显示隐藏文件</label><div class="folder-list" aria-label="宿主机文件列表"></div></section><p class="folder-status" role="status"></p><footer><button type="button" data-action="cancel">取消</button><button type="button" data-action="add" disabled>添加所选文件</button></footer>`;
  const status=modal.querySelector('.folder-status'),add=modal.querySelector('[data-action=add]'),chooser=modal.querySelector('input[type=file]'),directory=modal.querySelector('input[required]'),hidden=modal.querySelector('input[type=checkbox]'),list=modal.querySelector('.folder-list');
  const selected=new Set(),uploaded=[];let source='client',current=request.initialPath,parent=request.home,version=0,closed=false,busy=false,committing=false;
  const controller=new AbortController();controllers.add(controller);
  chooser.multiple=request.multiple;
  chooser.accept=request.extensions?.includes('*')?'':(request.extensions||[]).map(x=>'.'+x).join(',');
  function update(){add.disabled=busy||(source==='client'?uploaded.length===0:selected.size===0);}
  function dispose(){
   if(closed)return;closed=true;version++;controller.abort();controllers.delete(controller);window.removeEventListener('keydown',escape,true);
   modal.close();modal.remove();if(previousFocus?.isConnected)previousFocus.focus();
  }
  async function cancel(){if(closed)return;dispose();if(committing)return;if(connected){await call('upload.discardGroup',request.id).catch(()=>{});await call('folder.cancel',request.id).catch(()=>{});}}
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void cancel();}};
  window.addEventListener('keydown',escape,true);
  for(const type of ['pointerdown','pointerup','click','focusin','focusout'])modal.addEventListener(type,event=>event.stopPropagation());
  modal.oncancel=event=>{event.preventDefault();void cancel();};closeCurrent=()=>{void cancel();};
  async function load(target){
   const revision=++version;status.textContent='正在读取目录…';
   try{
    const data=await call('folder.list',request.id,target,hidden.checked);
    if(closed||revision!==version)return;
    current=data.path;parent=data.parent;directory.value=current;list.replaceChildren();
    for(const entry of data.directories){const button=document.createElement('button');button.type='button';button.textContent='📁 '+entry.name;button.onclick=()=>load(entry.path);list.append(button);}
    for(const entry of data.files){
     const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(entry.path);
     check.onchange=()=>{
      if(!request.multiple){selected.clear();for(const other of list.querySelectorAll('input'))if(other!==check)other.checked=false;}
      if(check.checked)selected.add(entry.path);else selected.delete(entry.path);update();status.textContent=`已选择 ${selected.size} 个宿主机文件`;
     };
     label.append(check,document.createTextNode(' '+entry.name));list.append(label);
    }
    status.textContent=`${data.files.length} 个文件，已选择 ${selected.size} 个`;update();
   }catch(error){if(!closed&&revision===version)status.textContent='无法读取：'+error.message;}
  }
  for(const button of modal.querySelectorAll('[data-source]'))button.onclick=()=>{
   if(busy)return;source=button.dataset.source;
   for(const tab of modal.querySelectorAll('[data-source]'))tab.setAttribute('aria-pressed',String(tab===button));
   for(const panel of modal.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==source;
   update();if(source==='host')void load(current);else status.textContent=`已上传 ${uploaded.length} 个客户端文件`;
  };
  modal.querySelector('form').onsubmit=event=>{event.preventDefault();void load(directory.value);};
  modal.querySelector('[data-action=home]').onclick=()=>load(request.home);
  modal.querySelector('[data-action=up]').onclick=()=>load(parent);hidden.onchange=()=>load(current);
  modal.querySelector('[data-action=choose]').onclick=()=>{if(!busy)chooser.click();};
  chooser.onchange=async()=>{
   const files=Array.from(chooser.files||[]);if(!files.length)return;
   busy=true;update();
   try{
    if(!request.multiple){await discard(uploaded);uploaded.length=0;}
    for(const file of files){status.textContent='正在上传 '+file.name;const result=await upload(file,controller.signal,request.id);if(closed){await discard([result]);break;}uploaded.push(result);}
    modal.querySelector('.client-file-list').textContent=uploaded.map(x=>x.name).join('\n');status.textContent=`已上传 ${uploaded.length} 个客户端文件`;
   }catch(error){if(!closed)status.textContent='上传失败：'+error.message;}
   finally{busy=false;chooser.value='';update();}
  };
  modal.querySelector('[data-action=close]').onclick=()=>{void cancel();};
  modal.querySelector('[data-action=cancel]').onclick=()=>{void cancel();};
  add.onclick=async()=>{
   committing=true;busy=true;update();
   try{
    if(source==='client')await call('folder.selectUploads',request.id,uploaded.map(x=>x.id));
    else {await call('folder.select',request.id,[...selected]);await discard(uploaded);}
    uploaded.length=0;dispose();
   }catch(error){if(!closed)status.textContent=error.message;else if(connected){await call('upload.discardGroup',request.id).catch(()=>{});await call('folder.cancel',request.id).catch(()=>{});}}
   finally{committing=false;busy=false;update();}
  };
  (owner||document.body).append(modal);modal.showModal();
 }
 // Snapshot files synchronously; the native clipboard expires after dispatch.
 // Deliver uploaded files through the drop path: the original image-paste
 // branch deliberately ignores getPathForFile and persists the bytes again.
 async function onPaste(event){
  if(!connected||event.defaultPrevented||replayed.has(event))return;
  if(!event.target?.closest?.('[data-codex-composer]'))return;
  const data=event.clipboardData;if(!data)return;
  const listed=Array.from(data.files||[]),items=Array.from(data.items||[]);
  const itemFiles=items.filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
  const files=itemFiles.length>listed.length?itemFiles:listed;
  if(!files.length)return; // Leave ordinary text/HTML paste to the editor.
  event.preventDefault();event.stopImmediatePropagation();
  if(items.some(item=>item.webkitGetAsEntry?.()?.isDirectory)){notice('暂不支持粘贴客户端文件夹，请选择文件。');return;}
  await uploadAndReplay(event,files,true);
 }
 // Capture native file drops before React reads the files, upload them, then
 // replay once with the same File objects and a synchronous host-path mapping.
 async function onDrop(event){
  if(!connected)return;
  if(replayed.has(event)||!event.dataTransfer?.files?.length)return;
  const files=Array.from(event.dataTransfer.files);
  const target=event.target;
  event.preventDefault();event.stopImmediatePropagation();
  if(target.closest?.('.host-folder-picker')){notice('请将文件拖到对话输入框，或使用窗口内的选择按钮。');return;}
  const hasDirectory=Array.from(event.dataTransfer.items||[]).some(item=>item.webkitGetAsEntry?.()?.isDirectory);
  if(hasDirectory){notice('暂不支持拖入客户端文件夹，请选择文件，或使用宿主机文件选择器。');return;}
  await uploadAndReplay(event,files);
 }
 async function uploadAndReplay(event,files,fromPaste=false){
  const target=event.target,route=location.href;
  const controller=new AbortController();controllers.add(controller);const uploaded=[],group=crypto.randomUUID(),notification={dismissed:false};
  try{
   for(const file of files){notice('正在上传 '+file.name,false,notification);uploaded.push(await upload(file,controller.signal,group));}
   if(!connected||!target.isConnected||location.href!==route)throw Error('对话页面已改变或连接断开，请回到目标对话重新添加附件');
   const transfer=new DataTransfer();
   files.forEach((file,index)=>{filePaths.set(file,uploaded[index].path);transfer.items.add(file);});
   Array.from(transfer.files).forEach((file,index)=>filePaths.set(file,uploaded[index].path));
   const bounds=fromPaste?target.getBoundingClientRect():null;
   // No clipboard text/HTML: OS file paths must not become editor text, and
   // ProseMirror must leave the file-only drop to the attachment receiver.
   const replay=new DragEvent('drop',{bubbles:true,cancelable:true,composed:true,dataTransfer:transfer,
    clientX:bounds?bounds.left+bounds.width/2:event.clientX,clientY:bounds?bounds.top+bounds.height/2:event.clientY});
   replayed.add(replay);
   // The official file-drop handler calls preventDefault when it consumes a
   // transfer. Do not retain orphan uploads or report success if nobody did.
   if(target.dispatchEvent(replay)!==false)throw Error('输入框未接收附件，请点击对话输入框后重试');
   await call('upload.retain',uploaded.map(x=>x.id));
   notice(`${files.length} 个文件已交给输入框处理。`,true,notification);
  }catch(error){if(connected)await call('upload.discardGroup',group).catch(()=>{});notice('无法添加文件：'+error.message,false,notification);}
  finally{controllers.delete(controller);}
 }
 const onDragOver=event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();};
 window.addEventListener('drop',onDrop,true);window.addEventListener('dragover',onDragOver,true);window.addEventListener('paste',onPaste,true);
 return {
  open,getPathForFile:file=>filePaths.get(file)||null,
  close(){connected=false;closeCurrent();for(const controller of controllers)controller.abort();window.removeEventListener('drop',onDrop,true);window.removeEventListener('dragover',onDragOver,true);window.removeEventListener('paste',onPaste,true);},
 };
};
