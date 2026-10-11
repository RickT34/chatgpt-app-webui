#!/usr/bin/env python3
"""Compare full/minimal host PSS with fresh profiles; no browser or model calls."""
import http.cookiejar
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def read_asar(file, name):
    with file.open('rb') as stream:
        prefix = struct.unpack('<4I', stream.read(16))
        entry = json.loads(stream.read(prefix[3]))
        for part in name.split('/'):
            entry = entry['files'][part]
        stream.seek(8 + prefix[1] + int(entry['offset']))
        return stream.read(entry['size'])


def verify_documents(mode):
    manifest = json.loads((ROOT / 'prepare-manifest.json').read_text())
    archive = ROOT / '.runtime/resources/app.asar'
    original = read_asar(Path(manifest['source']), 'webview/index.html')
    assert read_asar(archive, '.vite/build/web-original.html') == original
    native = read_asar(archive, 'webview/index.html')
    if mode == 'full':
        assert native == original
    else:
        assert b'data-chatgpt-web-host="minimal"' in native
        assert b'<script' not in native and b'<link' not in native
    print(f'PASS: {mode} native document; original browser HTML preserved', flush=True)


def memory_tree(parent):
    processes = {}
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            status = dict(line.split(':', 1) for line in (directory / 'status').read_text().splitlines() if ':' in line)
            processes[int(directory.name)] = (int(status['PPid']), directory, status)
        except (OSError, KeyError, ValueError):
            continue
    selected = {parent}
    while True:
        children = {pid for pid, (ppid, _, _) in processes.items() if ppid in selected}
        if children <= selected:
            break
        selected |= children
    rows = []
    for pid in sorted(selected):
        if pid not in processes:
            continue
        _, directory, status = processes[pid]
        try:
            rollup = dict(line.split(':', 1) for line in (directory / 'smaps_rollup').read_text().splitlines() if ':' in line)
            args = (directory / 'cmdline').read_bytes().split(b'\0')
            kind = next((arg.decode() for arg in args if arg.startswith(b'--type=')), status['Name'].strip())
            rows.append({'pid': pid, 'kind': kind, 'pss_kib': int(rollup['Pss'].split()[0]), 'rss_kib': int(status['VmRSS'].split()[0])})
        except (OSError, KeyError, ValueError):
            continue
    return {'pss_mib': round(sum(row['pss_kib'] for row in rows) / 1024, 2), 'processes': rows}


def prepare(env):
    with (ROOT / '.logs/memory-setup.log').open('w') as log:
        subprocess.run(['sh', 'scripts/start.sh', '--setup-only'], cwd=ROOT, env=env, stdout=log, stderr=log, check=True, timeout=300)


def run(mode, env, number):
    with tempfile.TemporaryDirectory(prefix='chatgpt-memory-') as temporary:
        work = Path(temporary)
        for name in ('.runtime', 'node_modules', 'prepare-manifest.json', 'bridge'):
            (work / name).symlink_to(ROOT / name)
        (work / '.logs').mkdir()
        child_env = {**env, 'CHATGPT_WEB_ROOT': str(work), 'CODEX_ELECTRON_USER_DATA_PATH': str(work / 'profile')}
        log_path = ROOT / f'.logs/memory-{mode}-{number}.log'
        with log_path.open('w') as log:
            proc = subprocess.Popen([str(ROOT / '.runtime/ChatGPT'), '--user-data-dir=' + str(work / 'profile'), '--ozone-platform=headless', '--disable-gpu', '--no-sandbox', '--password-store=basic'], cwd=work, env=child_env, stdout=log, stderr=log, start_new_session=True)
            try:
                started = time.monotonic()
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                while time.monotonic() - started < 60:
                    if proc.poll() is not None:
                        raise RuntimeError(f'{mode} host exited: {proc.returncode}; see {log_path}')
                    try:
                        login = (work / '.logs/access-url').read_text().strip()
                        with opener.open(login, timeout=2) as response:
                            response.read()
                        with opener.open(env['CHATGPT_WEB_ORIGIN'] + '/bridge/status', timeout=2) as response:
                            status = json.load(response)
                        if status['snapshot']:
                            break
                    except (OSError, ValueError):
                        pass
                    time.sleep(.2)
                else:
                    raise RuntimeError(f'{mode} host not ready; see {log_path}')
                assert status['hostRenderer'] == mode
                time.sleep(5)
                idle = memory_tree(proc.pid)
                for script, flags in [('smoke.cjs', []), ('smoke-native.cjs', []), ('smoke-static.cjs', []), ('smoke-pdf.cjs', ['--experimental-vm-modules'])]:
                    subprocess.run(['node', *flags, str(ROOT / 'scripts' / script)], cwd=work, env={**child_env, 'CHATGPT_WEB_URL': env['CHATGPT_WEB_ORIGIN']}, check=True, timeout=60)
                time.sleep(5)
                after = memory_tree(proc.pid)
                result = {'mode': mode, 'run': number, 'staticVersion': status['staticVersion'], 'rendererReadyMs': status['rendererReadyMs'], 'idle': idle, 'after_protocol_checks': after}
                print(json.dumps(result), flush=True)
                return result
            finally:
                # Some backend helpers start their own process groups. Track only
                # our descendants, with start times to avoid PID-reuse mistakes.
                descendants = {}
                for row in memory_tree(proc.pid)['processes']:
                    try:
                        descendants[row['pid']] = Path(f"/proc/{row['pid']}/stat").read_text().rsplit(')', 1)[1].split()[19]
                    except OSError:
                        pass
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
                    try:
                        proc.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    for pid, start in descendants.items():
                        try:
                            if Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19] == start:
                                os.kill(pid, sig)
                        except ProcessLookupError:
                            pass
                        except FileNotFoundError:
                            pass
                    if sig == signal.SIGTERM:
                        time.sleep(.5)


def main():
    (ROOT / '.logs').mkdir(exist_ok=True)
    with socket.socket() as check:
        check.bind(('127.0.0.1', 0))
        port = check.getsockname()[1]
    env = dict(os.environ)
    env.pop('CHATGPT_WEB_ACCESS_TOKEN', None)
    env.update(CHATGPT_WEB_PORT=str(port), CHATGPT_WEB_HOST='127.0.0.1', CHATGPT_WEB_ORIGIN=f'http://127.0.0.1:{port}', CHATGPT_WEB_AUTH='token')
    results = []
    try:
        for mode in ('full', 'minimal'):
            env['CHATGPT_WEB_HOST_RENDERER'] = mode
            prepare(env)
            verify_documents(mode)
            for number in (1, 2):
                results.append(run(mode, env, number))
            (ROOT / '.logs/memory-check.json').write_text(json.dumps(results, indent=2) + '\n')
        assert len({result['staticVersion'] for result in results}) == 1, 'Host mode must not change browser resources'
    finally:
        # Restore the caller's configured renderer/origin without launching it.
        prepare(os.environ.copy())


if __name__ == '__main__':
    main()
