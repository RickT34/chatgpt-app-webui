#!/usr/bin/env python3
"""Create a disposable App copy; never modify the installed package."""
import hashlib, json, os, pathlib, shutil, struct, datetime, fcntl, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(os.environ.get('CHATGPT_APP_DIR', '/usr/lib/chatgpt'))
RUNTIME = ROOT / '.runtime'
archive = SOURCE / 'resources/app.asar'
host_renderer = os.environ.get('CHATGPT_WEB_HOST_RENDERER', 'minimal')
if host_renderer not in ('minimal', 'full'):
    raise SystemExit('CHATGPT_WEB_HOST_RENDERER must be minimal or full')
(ROOT/'.logs').mkdir(exist_ok=True, mode=0o700)
inherited_lock = os.environ.get('CHATGPT_WEB_LOCK_FD')
lock = os.fdopen(os.dup(int(inherited_lock)), 'a') if inherited_lock else (ROOT/'.logs/instance.lock').open('a')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Stop the running Web App before preparing an update.')
with archive.open('rb') as f:
    prefix = struct.unpack('<4I', f.read(16))
    header = json.loads(f.read(prefix[3]))
    base = 8 + prefix[1]
    def entry(name):
        node = header
        for part in name.split('/'):
            node = node['files'][part]
        return node
    def read(name):
        node = entry(name)
        f.seek(base + int(node['offset']))
        return f.read(node['size'])
    package = json.loads(read('package.json'))
    preload = read('.vite/build/preload.js').decode()
    for marker in ['electronBridge', 'sendMessageFromView', 'connect-app-host', 'codex_desktop:get-initial-sidebar-bootstrap']:
        if marker not in preload:
            raise SystemExit(f'Unsupported App: missing preload marker {marker}')
    original_main = package['main']
    browser_html = read('webview/index.html')
    package['main'] = '.vite/build/web-entry.cjs'
    additions = {
        '.vite/build/web-original.html': browser_html,
        'package.json': json.dumps(package, indent=2).encode(),
        '.vite/build/preload.js': (preload + '''\n;require('electron').contextBridge.exposeInMainWorld('chatgptWebTransport', {
 send: value => require('electron').ipcRenderer.send('chatgpt-web:from-relay', value),
 getSnapshot: () => require('electron').ipcRenderer.sendSync('codex_desktop:get-shared-object-snapshot'),
 getInitialSidebarBootstrap: () => require('electron').ipcRenderer.sendSync('codex_desktop:get-initial-sidebar-bootstrap'),
 subscribe: callback => require('electron').ipcRenderer.on('chatgpt-web:to-relay', (_event, value) => callback(value))
});\n''').encode(),
        '.vite/build/web-entry.cjs': f'require("./web-main.cjs");\nrequire("./{pathlib.PurePosixPath(original_main).name}");\n'.encode(),
    }
    runtime_modules = [name for name in entry('.vite/build')['files'] if name.startswith('src-') and name.endswith('.js')]
    runtime_patches = 0
    for name in runtime_modules:
        source = read('.vite/build/' + name)
        if b'chrome-plugin-app-server-runtime' not in source:
            continue
        additions['.vite/build/' + name] = subprocess.run(
            ['node', str(ROOT/'bridge/native-patch.cjs')], input=source,
            stdout=subprocess.PIPE, check=True).stdout
        runtime_patches += 1
    if runtime_patches != 1:
        raise SystemExit(f'Unsupported App: expected one runtime validation module, found {runtime_patches}')
    additions['.vite/build/web-file-digest-cache.cjs'] = (ROOT/'bridge/file-digest-cache.cjs').read_bytes()
    if host_renderer == 'minimal':
        # The resident browser host implements this original admission protocol.
        # Fail preparation on incompatible upgrades instead of timing out later.
        browser_protocol = [b'registerWebviewHostSession', b'registerWebviewHost',
                            b'persist:codex-browser-app-route:', b'data-browser-sidebar-conversation-id',
                            b'browser-sidebar-destroy-webview', b'browser-sidebar-webview-destroyed']
        browser_sources = (read('.vite/build/' + name) for name in entry('.vite/build')['files']
                           if name.startswith('main-') and name.endswith('.js'))
        compatible = any(all(marker in source for marker in browser_protocol) for source in browser_sources)
        if not compatible:
            raise SystemExit('Unsupported App: native browser WebView protocol changed')
        # Keep the original window URL and preload (trusted IPC sender). Only the
        # unused host UI is removed; the browser still receives the original HTML.
        additions['webview/index.html'] = b'''<!doctype html><html data-chatgpt-web-host="minimal"><head>
<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self' about:">
<title>ChatGPT Web Host</title></head><body></body></html>'''
    # Small modules used only by the resident native relay, never the full UI.
    additions['webview/web-capnweb.js'] = (ROOT/'node_modules/capnweb/dist/index.js').read_bytes()
    for name in ['host.mjs', 'rpc-client.mjs', 'browser-host.mjs']:
        additions['webview/web-' + name] = (ROOT/'bridge'/name).read_text().replace("'./capnweb.js'", "'./web-capnweb.js'").replace("'./rpc-client.mjs'", "'./web-rpc-client.mjs'").encode()
    for name in ['main.cjs', 'bootstrap.cjs', 'page.cjs', 'static.cjs', 'startup.js', 'lifecycle.cjs', 'access.cjs', 'client.js', 'relay.js', 'codec.js', 'folders.cjs', 'uploads.cjs', 'downloads.cjs', 'files.cjs', 'rpc-client.mjs', 'browser-native.js', 'resources.js', 'attachments.js', 'folder-picker.js', 'folder-picker.css']:
        additions['.vite/build/web-' + name] = (ROOT / 'bridge' / name).read_bytes()
    payload_size = archive.stat().st_size - base
    offset = payload_size
    for name, content in additions.items():
        node = header
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'][part]
        node['files'][parts[-1]] = {'size': len(content), 'offset': str(offset), 'integrity': {
            'algorithm': 'SHA256', 'hash': hashlib.sha256(content).hexdigest(), 'blockSize': 4194304,
            'blocks': [hashlib.sha256(content[i:i+4194304]).hexdigest() for i in range(0, len(content), 4194304)]}}
        offset += len(content)
    RUNTIME.mkdir(exist_ok=True)
    for item in SOURCE.iterdir():
        dest = RUNTIME / item.name
        if item.name == 'resources':
            dest.mkdir(exist_ok=True)
            for resource in item.iterdir():
                target = dest / resource.name
                if resource.name != 'app.asar':
                    if target.is_symlink() and target.resolve() != resource.resolve():
                        target.unlink()
                    if not target.exists():
                        target.symlink_to(resource)
        elif item.name == 'ChatGPT':
            # Electron resolves resources relative to the executable; a symlink is insufficient.
            if not dest.exists() or dest.stat().st_size != item.stat().st_size or hashlib.sha256(dest.read_bytes()).digest() != hashlib.sha256(item.read_bytes()).digest():
                shutil.copy2(item, dest)
        elif dest.is_symlink():
            if dest.resolve() != item.resolve():
                dest.unlink(); dest.symlink_to(item)
        elif not dest.exists():
            dest.symlink_to(item)
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    padded = 4 + len(raw)
    padded += (-padded) % 4
    out = RUNTIME / 'resources/app.asar.tmp'
    with out.open('wb') as dst:
        dst.write(struct.pack('<4I', 4, padded + 4, padded, len(raw)))
        dst.write(raw)
        dst.write(b'\0' * (padded - 4 - len(raw)))
        f.seek(base)
        shutil.copyfileobj(f, dst)
        for content in additions.values():
            dst.write(content)
    out.replace(RUNTIME / 'resources/app.asar')
manifest = {'prepared_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': str(archive),
    'app_version': package['version'], 'host_renderer': host_renderer, 'source_sha256': hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest(),
    'original_main': original_main, 'patch_files': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted([*(ROOT/'bridge').iterdir(), ROOT/'scripts/prepare.py', ROOT/'scripts/prepare-static.cjs', ROOT/'scripts/start.sh', ROOT/'scripts/bootstrap.py', ROOT/'scripts/runtime.py', ROOT/'scripts/proxy.sh', ROOT/'package-lock.json']) if p.is_file()}}
(ROOT/'prepare-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
with (ROOT/'.logs/prepare-history.jsonl').open('a') as log:
    log.write(json.dumps(manifest)+'\n')
if os.environ.get('CHATGPT_WEB_LOG_LEVEL') == 'debug':
    print(json.dumps(manifest, indent=2))
else:
    print(f'Prepared App {package["version"]} ({host_renderer}); manifest: {ROOT/"prepare-manifest.json"}', flush=True)
subprocess.run(['node', str(ROOT/'scripts/prepare-static.cjs')], check=True)
