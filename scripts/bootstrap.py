#!/usr/bin/env python3
"""Check, confirm, install locally, prepare and launch. No sudo or system writes."""
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

ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = '26.1007.21434'
APP_HASHES = {
    'amd64': '276b5341c3d74b261d3ad52106f7fa7edde06841e4767fe2a40cb54099b1f3ed',
    'arm64': '55fae1e3fb1d6069a90620e9e70737dcf8bf2255604d157e282cc6748a1baf49',
}
DEB_BASE = 'https://persistent.oaistatic.com/codex-app-prod/linux/deb/pool/main/c/chatgpt/'
NODE_BASE = 'https://nodejs.org/dist/latest-v22.x/'


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


def main(arguments):
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
    electron_args = [a for a in arguments if a not in ('--yes', '--check', '--setup-only')]
    os.chdir(ROOT)
    # Checks never download, repair, or start the App.
    lock = None
    if not check:
        (ROOT / '.logs').mkdir(exist_ok=True, mode=0o700)
        lock = (ROOT / '.logs/instance.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Web UI is already running; stop it before setup/start')
    node_bin = ensure_node(yes, check)
    os.environ['PATH'] = str(node_bin) + os.pathsep + os.environ['PATH']
    source = ensure_app(yes, check)
    check_libraries(source)
    print(f'Python: {sys.executable}\nNode: {shutil.which("node")}\nApp: {source}', flush=True)
    lock_hash = sha256(ROOT / 'package-lock.json')
    marker = ROOT / 'node_modules/.chatgpt-webui-lock'
    dependencies_ready = subprocess.run(['node', '-e', 'require("ws");require("capnweb")'], cwd=ROOT, capture_output=True).returncode == 0
    if not dependencies_ready or not marker.exists() or marker.read_text().strip() != lock_hash:
        ask('Install project dependencies from package-lock.json using npm ci --ignore-scripts (cache in .deps/cache/npm)?', yes, check)
        subprocess.run(['npm', 'ci', '--ignore-scripts', '--cache', str(ROOT / '.deps/cache/npm')], check=True)
        marker.write_text(lock_hash + '\n')
    os.environ['CHATGPT_APP_DIR'] = str(source)
    if needs_prepare(source):
        if check:
            raise RuntimeError('Runtime is missing or stale; run scripts/start.sh to prepare it')
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


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'chatgpt-webui: {error}', file=sys.stderr)
        sys.exit(1)
