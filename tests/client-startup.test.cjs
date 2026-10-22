'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const codec=require('../bridge/codec.js'),startup=require('../bridge/startup.js');

test('startup uses the socket snapshot, retains queued actions and applies only newer state',async()=>{
 const window=new EventTarget(),downloads=[],notifications=[];
 const snapshot={getSystemThemeVariant:'dark',getInitialSidebarBootstrap:{threads:['current']},shared:{value:'snapshot',stable:'preserved'}};
 class Socket extends EventTarget{
  constructor(url){
   super();this.url=url;this.readyState=1;
   queueMicrotask(()=>{
    this.dispatchEvent(new Event('open'));
    for(const message of [
     {kind:'theme',value:'old'},
     {kind:'event',value:{type:'shared-object-updated',key:'stable',value:'obsolete'}},
     {kind:'download-ready',value:{name:'retained.txt'}},
     {kind:'bootstrap',value:snapshot},
     {kind:'event',value:{type:'shared-object-updated',key:'value',value:'newer'}},
     {kind:'theme',value:'light'},
    ]){
     const event=new MessageEvent('message',{data:codec.pack(message)});
     this.onmessage?.(event);this.dispatchEvent(event);
    }
   });
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 }
 const close=()=>{},document={currentScript:{src:'https://example.test/static/version/bridge/browser.js'},documentElement:{dataset:{}}};
 Object.assign(window,{
  chatgptWebStartup:{...startup,bootstrapReady:Promise.resolve({browser:false}),stage(){},fail(error){throw error;}},
  // Only the downloaded RPC module is substituted. The real startup/client
  // code, socket events, codec and state replay run unchanged.
  adapter:Promise.resolve({adaptAppHost(){throw Error('The fixture does not open RPC services');}}),
  chatgptWebCodec:codec,chatgptWebResources:{rewrite:value=>value},
  chatgptWebNative:()=>({clipboard:{},ready:value=>downloads.push(value),close}),
  chatgptWebBrowserView:{create:()=>({close})},chatgptWebFolderPicker:()=>({close}),chatgptWebAttachments:()=>({close}),
 });
 window.addEventListener('message',event=>notifications.push(event.data));
 vm.runInNewContext(fs.readFileSync('bridge/client.js','utf8').replace('import(chatgptWebRpcUrl)','window.adapter'),{
  window,document,URL,location:{protocol:'https:',host:'example.test'},WebSocket:Socket,MessageEvent,
  fetch:()=>{throw Error('Unexpected additional HTTP request');},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,
 });
 await window.chatgptWebReady;
 assert.equal(window.electronBridge.getSharedObjectSnapshotValue('stable'),'preserved');
 assert.equal(window.electronBridge.getSharedObjectSnapshotValue('value'),'newer');
 assert.equal(window.electronBridge.getSystemThemeVariant(),'light');
 assert.deepEqual(window.electronBridge.getInitialSidebarBootstrap(),snapshot.getInitialSidebarBootstrap);
 assert.deepEqual(downloads,[{name:'retained.txt'}]);
 assert.deepEqual(notifications,[{type:'shared-object-updated',key:'value',value:'newer'}]);
});
