'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const install=require('../bridge/external-links.cjs');
test('web links go to the connected client, never the host browser; native protocols retain handling',async()=>{
 const native=[],sent=[];let client={readyState:1,send:value=>sent.push(value)};
 const shell={openExternal:async(...args)=>native.push(args)};
 install(shell,()=>client,JSON.stringify);
 await shell.openExternal('https://example.com/a?b=1');
 assert.deepEqual(JSON.parse(sent[0]),{kind:'external-open',value:'https://example.com/a?b=1'});assert.equal(native.length,0);
 await shell.openExternal('mailto:hello@example.com',{activate:false});assert.equal(native.length,1);
 client=null;await assert.rejects(shell.openExternal('https://example.com'),/No Web UI/);assert.equal(native.length,1);
});
function browser(popup){
 const opened=[],body={children:[],append(...items){this.children.push(...items);}};
 const document={body,createElement:tag=>({tag,style:{},children:[],append(...items){this.children.push(...items);},setAttribute(){},remove(){this.removed=true;}})};
 const window={open:(...args)=>{opened.push(args);return popup;}};
 vm.runInNewContext(fs.readFileSync('bridge/browser-native.js','utf8'),{window,document,navigator:{},URL});
 return {adapter:window.chatgptWebNative(()=>{throw Error('Must not call host');}),body,opened};
}
test('new tab severs opener before navigating and rejects unsafe URLs',()=>{
 const navigations=[],popup={opener:{},location:{replace:url=>{assert.equal(popup.opener,null);navigations.push(url);}}};
 const b=browser(popup);assert.equal(b.adapter.openExternal('https://example.com/path'),true);
 assert.deepEqual(b.opened,[['about:blank','_blank']]);assert.deepEqual(navigations,['https://example.com/path']);
 for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/a','bad'])assert.equal(b.adapter.openExternal(url),false);
 assert.equal(b.opened.length,1);assert.equal(b.body.children.length,0);
});
test('blocked popup offers an actual safe new-tab link',()=>{
 const b=browser(null);assert.equal(b.adapter.openExternal('http://localhost:3000'),false);
 const box=b.body.children[0],link=box.children.find(n=>n.tag==='a');
 assert.equal(link.href,'http://localhost:3000/');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
 link.onclick();assert.equal(box.removed,true);
});
test('labels change by message ID without changing destination values or unrelated labels',()=>{
 const patch=require('../bridge/link-labels.cjs');
 const id='settings.general.openLinkInTargetPreference.externalBrowser.label';
 assert.match(patch('"'+id+'":`默认浏览器`','assets/zh-CN-test.js'),/客户端浏览器（新标签页）/);
 for(const text of ['{id:`'+id+'`,defaultMessage:`Default browser`}','{defaultMessage:`Default browser`,id:`'+id+'`}'])assert.match(patch(text,'assets/settings.js'),/Client browser \(new tab\)/);
 assert.equal(patch('const target=`external-browser`;const other=`Default browser`;','assets/settings.js'),'const target=`external-browser`;const other=`Default browser`;');
});
