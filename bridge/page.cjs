'use strict';
const bridgeScripts=['identity.js','codec.js','statsig-storage.js','statsig-bootstrap.js','folder-picker.js','attachments.js','resources.js','browser-native.js','browser-view.js','client.js'];
function bridgeBundle(read){
 // Preserve script order and separate lexical scopes without another bundler.
 return bridgeScripts.map(file=>`// bridge/${file}\n(()=>{\n${read(file)}\n})();`).join('\n;\n');
}
// Keep preparation and HTTP rendering on the same entry/preload contract.
function entryPath(html){
 const match=html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
 if(!match)throw Error('Unsupported App: cannot locate renderer module entry');
 return match[1].replace(/^\.\//,'/');
}
function entryScript(html){
 const entry='../'+entryPath(html).replace(/^\//,'');
 return `try{await window.chatgptWebReady;const s=window.chatgptWebStartup;if(s.failed)throw Error('启动已中止');s.stage('下载并启动原界面');await s.wait(import(${JSON.stringify(entry)}),120000,'原界面模块加载超时');s.entryReady();}catch(e){window.chatgptWebStartup.fail(e);}`;
}
function renderPage(html,{startup,version,websocketOrigin,preloads=[],title='ChatGPT Web'}){
 const prefix=`/static/${version}`;
 const hash=require('node:crypto').createHash('sha256').update(startup).digest('base64');
 const pageTitle=(String(title??'').replace(/\s+/g,' ').trim()||'ChatGPT Web')
  .replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 html=html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'')
  .replace('</head>',()=>`<title>${pageTitle}</title><meta name="chatgpt-web-title" content="${pageTitle}"><link rel="icon" type="image/svg+xml" href="/bridge/favicon.svg"></head>`);
 // Explicit URLs preserve the root base used by the original router. Relative
 // imports inside versioned modules automatically inherit the same version.
 html=html.replace(/<script type="module" crossorigin src="[^"]+"><\/script>/,
  `<script>${startup}</script><link rel="stylesheet" href="/bridge/folder-picker.css">`+
  '<script defer src="/bridge/browser.js"></script>'+
  '<script type="module" src="/bridge/entry.js"></script>');
 html=html.replace(/\b(src|href)="(?:\.\/|\/)(assets\/[^"<>]+|bridge\/[^"<>]+)"/g,`$1="${prefix}/$2"`);
 const links=[...new Set(preloads)].map(file=>`<link rel="modulepreload" crossorigin href="${prefix}/${file}">`).join('');
 return html.replace('<head>','<head><base href="/">').replace('</head>',`${links}</head>`)
  .replace('script-src ',`script-src &#39;sha256-${hash}&#39; `)
  .replace(/<meta name="referrer" content="[^"]+"/,'<meta name="referrer" content="no-referrer"')
  .replace('connect-src ',`connect-src ${websocketOrigin} `);
}
module.exports={entryPath,entryScript,renderPage,bridgeScripts,bridgeBundle};
