'use strict';
// Patch message IDs, not arbitrary translated text or preference values.
module.exports=function linkLabels(source,name){
 const zh=/\/(?:zh-CN|zh-TW)-/.test(name),traditional=/\/zh-TW-/.test(name);
 const label=zh?(traditional?'客戶端瀏覽器（新分頁）':'客户端浏览器（新标签页）'):'Client browser (new tab)';
 const action=zh?(traditional?'在客戶端瀏覽器新分頁開啟':'在客户端浏览器新标签页打开'):'Open in a new client browser tab';
 const labels=['settings.general.openLinkInTargetPreference.externalBrowser.label','settings.browserUse.localUrlOpenTarget.externalBrowser.label','externalLink.contextMenu.defaultBrowser','externalLink.contextMenu.defaultBrowserUnavailable','linkDestinationPrompt.openExternalBrowser'];
 const actions=['externalLink.contextMenu.openInExternalBrowser','contextualLinkDestinationPrompt.openInDefaultBrowser','linkDestinationPrompt.openExternalBrowserDescription','localConversation.endResource.openInDefaultBrowserSubtitle','browserSidebar.contextMenu.openExternalBrowser','thread.browser.openExternalBrowser','thread.sidePanel.browserTabMenu.openInExternalBrowser','settings.keyboardShortcuts.externalBrowserLinkShortcut.title'];
 const messages=new Map([...labels.map(id=>[id,label]),...actions.map(id=>[id,action])]);
 messages.set('contextualLinkDestinationPrompt.description',zh?'使用 ChatGPT 内置浏览器，或在客户端浏览器新标签页打开':'Use the ChatGPT browser or open a new tab in your client browser');
 messages.set('settings.keyboardShortcuts.externalBrowserLinkShortcut.description',zh?'按住指定按键并点击网页链接，即可在客户端浏览器新标签页打开':'Hold the assigned keys and click a web link to open a new client browser tab');
 for(const [id,value] of messages){
  const key=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Locale catalog entries and both descriptor orders used by the App.
  source=source.replace(new RegExp('("'+key+'"\\s*:\\s*)`[^`]*`','g'),(_,prefix)=>prefix+JSON.stringify(value));
  source=source.replace(new RegExp('(id:`'+key+'`,defaultMessage:)`[^`]*`','g'),(_,prefix)=>prefix+JSON.stringify(value));
  source=source.replace(new RegExp('defaultMessage:`[^`]*`,id:`'+key+'`','g'),()=> 'defaultMessage:'+JSON.stringify(value)+',id:`'+id+'`');
 }
 return source;
};
