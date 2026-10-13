(function(){
 'use strict';
 const title=document.querySelector('meta[name="chatgpt-web-title"]').content;
 const restore=()=>{if(document.title!==title)document.title=title;};
 // Covers both document.title assignments and React replacing/editing <title>.
 new MutationObserver(restore).observe(document.head,{childList:true,subtree:true,characterData:true});
 restore();
})();
