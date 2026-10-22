#!/usr/bin/env python3
"""Check, confirm, install locally, prepare and launch. No sudo or system writes."""
from contextlib import ExitStack
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = '26.1007.21434'
APP_HASHES = {
    'amd64': '276b5341c3d74b261d3ad52106f7fa7edde06841e4767fe2a40cb54099b1f3ed',
    'arm64': '55fae1e3fb1d6069a90620e9e70737dcf8bf2255604d157e282cc6748a1baf49',
}
DEB_BASE = 'https://persistent.oaistatic.com/codex-app-prod/linux/deb/pool/main/c/chatgpt/'
NODE_BASE = 'https://nodejs.org/dist/latest-v22.x/'
APP_REPOSITORY = 'https://persistent.oaistatic.com/codex-app-prod/linux/deb/'


def sha256(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def architecture(machine=None):
    value = machine or platform.machine()
    if value == 'x86_64':
        return 'x64', 'amd64'
    if value in ('aarch64', 'arm64'):
        return 'arm64', 'arm64'
    raise RuntimeError(f'Unsupported architecture: {value}; supported: x86_64/aarch64')


def ask(message, yes=False, check=False):
    print(message, flush=True)
    if check:
        raise RuntimeError('Check only: missing component; nothing downloaded.')
    if yes:
        return
    if not sys.stdin.isatty():
        raise RuntimeError('No interactive terminal. Run interactively or pass --yes to approve downloads.')
    if input('Continue [y/N]: ').strip().lower() not in ('y', 'yes'):
        raise RuntimeError('Canceled. No download performed.')


def download(url, target, digest=None):
    if not url.startswith('https://'):
        raise RuntimeError('Downloads require HTTPS')
    target = Path(target)
    if digest and target.exists() and sha256(target) == digest:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + '.part')
    try:
        print(f'Downloading {url}', flush=True)
        curl = shutil.which('curl')
        if curl:
            # curl supports system CA settings and HTTP(S)/SOCKS proxy environments.
            # Keep proxy credentials in the environment, never in process arguments.
            result = subprocess.run([curl, '--proto', '=https', '--proto-redir', '=https',
                                     '--fail', '--location', '--silent', '--show-error',
                                     '--retry', '2', '--connect-timeout', '30', '--max-time', '600',
                                     '--output', str(part), '--url', url], capture_output=True)
            if result.returncode:
                raise RuntimeError(f'Download failed (curl exit {result.returncode}). Check the proxy address, NO_PROXY and CA trust settings.')
        else:
            proxies = urllib.request.getproxies()
            proxy = proxies.get('https') or proxies.get('all') or proxies.get('http')
            if proxy and not proxy.startswith('http://'):
                raise RuntimeError('Install curl for SOCKS/HTTPS proxy downloads, or use an HTTP proxy endpoint.')
            if proxy:
                proxies['https'] = proxy
            opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies))
            with opener.open(url, timeout=60) as response, part.open('wb') as output:
                if not response.url.startswith('https://'):
                    raise RuntimeError('Refusing an insecure redirect')
                shutil.copyfileobj(response, output)
        if digest and sha256(part) != digest:
            raise RuntimeError(f'SHA-256 mismatch: {target.name}')
        part.replace(target)
        history = ROOT / '.deps/install-history.jsonl'
        history.parent.mkdir(parents=True, exist_ok=True)
        with history.open('a') as log:
            log.write(json.dumps({'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                  'url': url, 'file': str(target), 'sha256': sha256(target),
                                  'checksum_verified': digest is not None}) + '\n')
    finally:
        part.unlink(missing_ok=True)
    return target


def extract_tar(file, destination, app_only=False):
    with tarfile.open(file) as archive:
        members = (m for m in archive.getmembers() if m.name.removeprefix('./').startswith('usr/lib/chatgpt/')) if app_only else None
        archive.extractall(destination, members=members, filter='data')


def extract_deb(file, destination):
    """Read ar members without dpkg/ar; only extract the App payload, no scripts."""
    with Path(file).open('rb') as stream:
        if stream.read(8) != b'!<arch>\n':
            raise RuntimeError('Invalid Debian package')
        while header := stream.read(60):
            if len(header) != 60 or header[58:] != b'`\n':
                raise RuntimeError('Invalid Debian member header')
            name = header[:16].decode().strip().rstrip('/')
            size = int(header[48:58])
            if name.startswith('data.tar'):
                with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
                    payload = Path(temporary) / name
                    with payload.open('wb') as output:
                        remaining = size
                        while remaining:
                            block = stream.read(min(1024 * 1024, remaining))
                            if not block:
                                raise RuntimeError('Truncated Debian package')
                            output.write(block)
                            remaining -= len(block)
                    extract_tar(payload, destination, app_only=True)
                return
            stream.seek(size + size % 2, 1)
    raise RuntimeError('No data.tar payload in Debian package')


def usable_node(binary):
    try:
        version = subprocess.check_output([str(binary), '--version'], text=True).strip()
        return int(version.lstrip('v').split('.')[0]) >= 22
    except (OSError, ValueError, subprocess.CalledProcessError):
        return False


def ensure_node(yes, check):
    node_arch, _ = architecture()
    local = ROOT / '.deps/node/bin'
    system = shutil.which('node')
    if system and usable_node(system) and shutil.which('npm'):
        return Path(system).parent
    if usable_node(local / 'node') and (local / 'npm').exists():
        return local
    ask(f'Missing Node.js 22+/npm. Download Node.js 22 LTS ({node_arch}) from nodejs.org into {ROOT / ".deps/node"}?', yes, check)
    sums = download(NODE_BASE + 'SHASUMS256.txt', ROOT / '.deps/downloads/node-SHASUMS256.txt').read_text()
    matches = re.findall(rf'^([a-f0-9]{{64}})\s+(node-v22\.[\d.]+-linux-{node_arch}\.tar\.gz)$', sums, re.M)
    if len(matches) != 1:
        raise RuntimeError('Cannot resolve Node.js 22 archive from official checksums')
    digest, filename = matches[0]
    version = filename.split('-')[1]
    archive = download(f'https://nodejs.org/dist/{version}/{filename}', ROOT / '.deps/downloads' / filename, digest)
    with tempfile.TemporaryDirectory(dir=ROOT / '.deps') as temporary:
        extract_tar(archive, temporary)
        installed = Path(temporary) / filename.removesuffix('.tar.gz')
        if not usable_node(installed / 'bin/node'):
            raise RuntimeError('Downloaded Node cannot run; check host glibc compatibility')
        target = ROOT / '.deps/node'
        if target.exists():
            shutil.rmtree(target)
        installed.rename(target)
    return local


def app_exists(directory):
    return (directory / 'ChatGPT').is_file() and (directory / 'resources/app.asar').is_file()


def ensure_app(yes, check):
    explicit = os.environ.get('CHATGPT_APP_DIR')
    if explicit:
        selected = Path(explicit).expanduser().resolve()
        if not app_exists(selected):
            raise RuntimeError(f'CHATGPT_APP_DIR is invalid: {selected}; unset it to enable automatic discovery/download')
        return selected
    state = desktop_state()
    if state:
        return validate_release(state['current'])
    _, deb_arch = architecture()
    local_root = ROOT / f'.deps/chatgpt-{APP_VERSION}-{deb_arch}'
    candidates = [local_root / 'usr/lib/chatgpt', Path('/usr/lib/chatgpt'), Path('/opt/chatgpt')]
    for candidate in candidates:
        if app_exists(candidate):
            return candidate
    filename = f'chatgpt_{APP_VERSION}_{deb_arch}.deb'
    ask(f'Missing ChatGPT Desktop. Download official {APP_VERSION} ({deb_arch}, about 500 MB) from persistent.oaistatic.com and extract into {local_root}? Requires about 3 GB free including the runtime copy.', yes, check)
    if shutil.disk_usage(ROOT).free < 3 * 1024**3:
        raise RuntimeError('At least 3 GiB free space is required')
    package = download(DEB_BASE + filename, ROOT / '.deps/downloads' / filename, APP_HASHES[deb_arch])
    with tempfile.TemporaryDirectory(dir=ROOT / '.deps') as temporary:
        extracted = Path(temporary) / 'package'
        extracted.mkdir()
        extract_deb(package, extracted)
        if not app_exists(extracted / 'usr/lib/chatgpt'):
            raise RuntimeError('Unexpected ChatGPT package layout; no installed files changed')
        if local_root.exists():
            shutil.rmtree(local_root)
        extracted.rename(local_root)
    return local_root / 'usr/lib/chatgpt'


def check_libraries(app):
    if not shutil.which('ldd'):
        raise RuntimeError('ldd is required to check native App dependencies. Install your distribution libc tools first.')
    result = subprocess.run(['ldd', str(app / 'ChatGPT')], text=True, capture_output=True)
    missing = [line.strip() for line in (result.stdout + result.stderr).splitlines() if 'not found' in line]
    if missing or result.returncode:
        raise RuntimeError('App native dependencies are unavailable:\n' + '\n'.join(missing or [result.stderr.strip()]) +
                           '\nInstall the listed libraries using your distribution package manager. System libc/GTK/NSS cannot be safely replaced by repository downloads; no sudo commands were run.')


def needs_prepare(source):
    try:
        manifest = json.loads((ROOT / 'prepare-manifest.json').read_text())
        if manifest.get('host_renderer') != os.environ.get('CHATGPT_WEB_HOST_RENDERER', 'minimal'):
            return True
        if not (ROOT / '.runtime/ChatGPT').exists() or not (ROOT / '.runtime/resources/app.asar').exists():
            return True
        if manifest['source'] != str(source / 'resources/app.asar') or manifest['source_sha256'] != sha256(source / 'resources/app.asar'):
            return True
        expected = set(str(p.relative_to(ROOT)) for p in (ROOT / 'bridge').iterdir() if p.is_file())
        if not expected.issubset(manifest['patch_files']):
            return True
        return any(not (ROOT / file).exists() or sha256(ROOT / file) != digest for file, digest in manifest['patch_files'].items())
    except (OSError, ValueError, KeyError):
        return True


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def desktop_state():
    path = ROOT / '.deps/desktop-state.json'
    if not path.exists():
        return None
    state = json.loads(path.read_text())
    if state.get('format') != 1 or not isinstance(state.get('current'), dict):
        raise RuntimeError(f'Invalid Desktop version state: {path}')
    return state


def validate_release(release):
    if not isinstance(release, dict) or any(not isinstance(release.get(key), str)
                                          for key in ('source', 'version', 'source_sha256')):
        raise RuntimeError('Invalid saved Desktop release record')
    source = Path(release['source'])
    if not app_exists(source) or sha256(source / 'resources/app.asar') != release['source_sha256']:
        raise RuntimeError(f'Saved Desktop source is missing or changed: {source}')
    return source


def describe_release(source):
    archive = source / 'resources/app.asar'
    with archive.open('rb') as stream:
        prefix = struct.unpack('<4I', stream.read(16))
        package = json.loads(stream.read(prefix[3]))['files']['package.json']
        stream.seek(8 + prefix[1] + int(package['offset']))
        version = json.loads(stream.read(package['size']))['version']
    return {'source': str(source), 'version': version, 'source_sha256': sha256(archive)}


def latest_desktop(index, arch):
    """Select numeric stable releases from the official Debian Packages index."""
    releases = []
    for paragraph in re.split(r'\n\s*\n', index.strip()):
        fields = dict(line.split(': ', 1) for line in paragraph.splitlines()
                      if not line.startswith((' ', '\t')) and ': ' in line)
        if fields.get('Package') != 'chatgpt' or fields.get('Architecture') != arch:
            continue
        version = fields.get('Version', '')
        filename = fields.get('Filename', '')
        digest = fields.get('SHA256', '')
        if (not re.fullmatch(r'\d+(?:\.\d+)+(?:-\d+)?', version)
                or filename != f'pool/main/c/chatgpt/chatgpt_{version}_{arch}.deb'
                or not re.fullmatch(r'[a-f0-9]{64}', digest)):
            raise RuntimeError('Invalid Desktop release metadata in the official package index')
        releases.append({'version': version, 'filename': filename, 'sha256': digest})
    if not releases:
        raise RuntimeError(f'No stable ChatGPT Desktop package found for {arch}')
    return max(releases, key=lambda release: tuple(map(int, re.findall(r'\d+', release['version']))))


def remove_path(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def recover_desktop_switch(check=False):
    """Undo an interrupted publication before normal discovery or another update."""
    journal = ROOT / '.deps/desktop-transaction.json'
    if not journal.exists():
        return
    if check:
        raise RuntimeError('Interrupted Desktop switch; run --setup-only to recover it')
    transaction = json.loads(journal.read_text())
    for entry in reversed(transaction['entries']):
        target, backup = Path(entry['target']), Path(entry['backup'])
        if backup.exists():
            remove_path(target)
            backup.replace(target)
        elif not entry['existed'] and not Path(entry['source']).exists():
            remove_path(target)
    journal.unlink()
    shutil.rmtree(transaction['stage'], ignore_errors=True)
    print('Recovered the previous Desktop after an interrupted switch.', flush=True)


def publish_desktop(stage, state):
    """Publish runtime, manifest and selection together, with restart recovery."""
    atomic_json(stage / 'desktop-state.json', state)
    pairs = [(stage / '.runtime', (ROOT / '.runtime').resolve()),
             (stage / 'prepare-manifest.json', (ROOT / 'prepare-manifest.json').resolve()),
             (stage / 'desktop-state.json', (ROOT / '.deps/desktop-state.json').resolve())]
    entries = [{'source': str(source), 'target': str(target),
                'backup': str(stage / f'backup-{number}'), 'existed': target.exists()}
               for number, (source, target) in enumerate(pairs)]
    journal = ROOT / '.deps/desktop-transaction.json'
    atomic_json(journal, {'stage': str(stage), 'entries': entries})
    try:
        for entry in entries:
            target = Path(entry['target'])
            if entry['existed']:
                target.replace(entry['backup'])
            Path(entry['source']).replace(target)
        journal.unlink()  # Commit only after every path is published.
    except BaseException:
        recover_desktop_switch()
        raise


def switch_desktop(action, current, yes, lock_fd):
    state = desktop_state()
    if action == 'rollback':
        if not state or not state.get('previous'):
            raise RuntimeError('No previous Desktop version saved; rollback is available after a successful update')
        release = state['previous']
        source = validate_release(release)
    else:
        _, arch = architecture()
        index = download(APP_REPOSITORY + f'dists/stable/main/binary-{arch}/Packages',
                         ROOT / f'.deps/downloads/desktop-{arch}-Packages').read_text()
        latest = latest_desktop(index, arch)
        current_release = describe_release(current)
        if current_release['version'] == latest['version']:
            print(f'Desktop {latest["version"]} is already the latest stable version; previous version retained.')
            return
        if (re.fullmatch(r'\d+(?:\.\d+)+(?:-\d+)?', current_release['version'])
                and tuple(map(int, re.findall(r'\d+', current_release['version'])))
                > tuple(map(int, re.findall(r'\d+', latest['version'])))):
            print(f'Desktop {current_release["version"]} is newer than stable {latest["version"]}; no update performed.')
            return
        ask(f'Update Desktop {current_release["version"]} -> {latest["version"]} ({arch})? '
            'Download from persistent.oaistatic.com, verify SHA-256 and save the previous version locally.', yes)
        if shutil.disk_usage(ROOT).free < 6 * 1024**3:
            raise RuntimeError('At least 6 GiB free space is required for the download, staged runtime and previous source')
        package = download(APP_REPOSITORY + latest['filename'],
                           ROOT / '.deps/downloads' / Path(latest['filename']).name, latest['sha256'])
        # Never overwrite an extracted source that a runtime or rollback may use.
        sources = ROOT / '.deps/desktop-sources'
        sources.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=sources) as temporary:
            extracted = Path(temporary) / 'package'
            extracted.mkdir()
            extract_deb(package, extracted)
            if not app_exists(extracted / 'usr/lib/chatgpt'):
                raise RuntimeError('Unexpected ChatGPT package layout; current version retained')
            installed = sources / f'{latest["version"]}-{arch}-{uuid.uuid4().hex}'
            extracted.rename(installed)
        source = installed / 'usr/lib/chatgpt'
        release = describe_release(source)
        if release['version'] != latest['version']:
            raise RuntimeError('Desktop package version does not match the stable index')
        release['package_sha256'] = latest['sha256']
    check_libraries(source)
    # Stage alongside the real runtime (also works with Docker's /data symlink).
    runtime_parent = (ROOT / '.runtime').resolve().parent
    stage = Path(tempfile.mkdtemp(prefix='.desktop-stage-', dir=runtime_parent))
    try:
        environment = {**os.environ, 'CHATGPT_APP_DIR': str(source),
                       'CHATGPT_WEB_PREPARE_DIR': str(stage), 'CHATGPT_WEB_LOCK_FD': str(lock_fd)}
        subprocess.run([sys.executable, str(ROOT / 'scripts/prepare.py')],
                       env=environment, check=True, pass_fds=(lock_fd,))
        if action == 'update':
            if state:
                previous = state['current']
                validate_release(previous)
            else:
                # Snapshot even a system installation so later system updates
                # cannot remove or silently change our rollback source.
                snapshot = ROOT / '.deps/desktop-sources' / f'previous-{uuid.uuid4().hex}'
                shutil.copytree(current, snapshot, symlinks=False)
                previous = describe_release(snapshot)
                if previous['source_sha256'] != current_release['source_sha256']:
                    raise RuntimeError('Original Desktop changed during the update; current selection retained')
        else:
            previous = None  # One-level rollback, not a toggle back to the newer version.
        publish_desktop(stage, {'format': 1, 'current': release, 'previous': previous})
    finally:
        if not (ROOT / '.deps/desktop-transaction.json').exists():
            shutil.rmtree(stage, ignore_errors=True)
    print(f'Desktop {action} complete: {release["version"]}. Start with your usual command.', flush=True)


def _main(arguments, stack):
    if os.environ.get('CHATGPT_WEB_LOG_LEVEL', 'normal') not in ('normal', 'debug'):
        raise RuntimeError('CHATGPT_WEB_LOG_LEVEL must be normal or debug')
    if os.environ.get('CHATGPT_WEB_HOST_RENDERER', 'minimal') not in ('minimal', 'full'):
        raise RuntimeError('CHATGPT_WEB_HOST_RENDERER must be minimal or full')
    if platform.system() != 'Linux':
        raise RuntimeError('Only Linux is supported')
    architecture()
    yes = '--yes' in arguments or os.environ.get('CHATGPT_WEB_SETUP_YES') == '1'
    check = '--check' in arguments
    setup_only = '--setup-only' in arguments
    actions = [a.removeprefix('--') for a in arguments if a in ('update', 'rollback', '--update', '--rollback')]
    action = actions[0] if actions else None
    electron_args = [a for a in arguments if a not in ('--yes', '--check', '--setup-only', 'update', 'rollback', '--update', '--rollback')]
    if action and (len(actions) != 1 or check or electron_args):
        raise RuntimeError('Usage: scripts/start update|rollback [--yes]; do not combine with --check or Electron options')
    if action and os.environ.get('CHATGPT_APP_DIR'):
        raise RuntimeError('Unset CHATGPT_APP_DIR before update/rollback; it overrides the saved Desktop selection')
    os.chdir(ROOT)
    # Checks never download, repair, or start the App.
    lock = None
    if not check:
        (ROOT / '.logs').mkdir(exist_ok=True, mode=0o700)
        lock = stack.enter_context((ROOT / '.logs/instance.lock').open('a'))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Web UI is already running; stop it before setup/start/update/rollback')
    recover_desktop_switch(check)
    if action == 'rollback' and not (desktop_state() or {}).get('previous'):
        raise RuntimeError('No previous Desktop version saved; rollback is available after a successful update')
    node_bin = ensure_node(yes, check)
    os.environ['PATH'] = str(node_bin) + os.pathsep + os.environ['PATH']
    source = validate_release(desktop_state()['previous']) if action == 'rollback' else ensure_app(yes, check or bool(action))
    if not action:
        check_libraries(source)
    print(f'Python: {sys.executable}\nNode: {shutil.which("node")}\nApp: {source}', flush=True)
    lock_hash = sha256(ROOT / 'package-lock.json')
    marker = ROOT / 'node_modules/.chatgpt-webui-lock'
    dependencies_ready = subprocess.run(['node', '-e', 'require("ws");require("capnweb")'], cwd=ROOT, capture_output=True).returncode == 0
    if not dependencies_ready or not marker.exists() or marker.read_text().strip() != lock_hash:
        ask('Install project dependencies from package-lock.json using npm ci --ignore-scripts (cache in .deps/cache/npm)?', yes, check)
        subprocess.run(['npm', 'ci', '--ignore-scripts', '--cache', str(ROOT / '.deps/cache/npm')], check=True)
        marker.write_text(lock_hash + '\n')
    if action:
        switch_desktop(action, source, yes, lock.fileno())
        return
    os.environ['CHATGPT_APP_DIR'] = str(source)
    if needs_prepare(source):
        if check:
            raise RuntimeError('Runtime is missing or stale; run scripts/start to prepare it')
        print('Preparing App copy...', flush=True)
        os.environ['CHATGPT_WEB_LOCK_FD'] = str(lock.fileno())
        subprocess.run([sys.executable, str(ROOT / 'scripts/prepare.py')], check=True, pass_fds=(lock.fileno(),))
        del os.environ['CHATGPT_WEB_LOCK_FD']
    subprocess.run(['node', str(ROOT / 'scripts/prepare-static.cjs'), *(['--check'] if check else [])], check=True)
    if check or setup_only:
        print('Environment ready.', flush=True)
        return
    os.environ['CHATGPT_WEB_ROOT'] = str(ROOT)
    os.environ['CODEX_ELECTRON_USER_DATA_PATH'] = str(ROOT / '.profile')
    os.environ.setdefault('CHATGPT_WEB_PORT', '18765')
    os.set_inheritable(lock.fileno(), True)
    binary = str(ROOT / '.runtime/ChatGPT')
    from runtime import run
    return run([binary, '--user-data-dir=' + str(ROOT / '.profile'), *electron_args], lock.fileno())


def main(arguments):
    with ExitStack() as stack:
        return _main(arguments, stack)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'chatgpt-webui: {error}', file=sys.stderr)
        sys.exit(1)
