"""Measure an already prepared runtime with a private profile and local port."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
from importlib.util import spec_from_file_location, module_from_spec

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location('memory_smoke', ROOT/'scripts/smoke-memory.py')
memory = module_from_spec(spec)
spec.loader.exec_module(memory)


def cpu(parent):
    total = 0
    for row in memory.memory_tree(parent)['processes']:
        try:
            fields = Path(f"/proc/{row['pid']}/stat").read_text().rsplit(')', 1)[1].split()
            total += int(fields[11]) + int(fields[12])
        except FileNotFoundError:
            pass
    return total / os.sysconf('SC_CLK_TCK')


def main():
    with tempfile.TemporaryDirectory(prefix='web-warm-smoke-') as temporary:
        work = Path(temporary)
        for name in ('.runtime', 'prepare-manifest.json', 'node_modules', 'bridge'):
            (work/name).symlink_to(ROOT/name)
        with socket.socket() as socket_probe:
            socket_probe.bind(('127.0.0.1', 0))
            port = socket_probe.getsockname()[1]
        env = dict(os.environ)
        env.pop('CHATGPT_WEB_ACCESS_TOKEN', None)
        env.update(CHATGPT_WEB_ROOT=str(work), CHATGPT_WEB_PORT=str(port), CHATGPT_WEB_HOST='127.0.0.1', CHATGPT_WEB_ORIGIN=f'http://127.0.0.1:{port}', CHATGPT_WEB_AUTH='none', CODEX_ELECTRON_USER_DATA_PATH=str(work/'profile'))
        with (ROOT/'.logs/warm-host-smoke.log').open('w') as log:
            proc = subprocess.Popen([str(ROOT/'.runtime/ChatGPT'), '--user-data-dir='+str(work/'profile'), '--ozone-platform=headless', '--disable-gpu', '--no-sandbox', '--password-store=basic'], cwd=work, env=env, stdout=log, stderr=log, start_new_session=True)
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                started = time.monotonic()
                while time.monotonic()-started < 120:
                    if proc.poll() is not None:
                        raise RuntimeError('Host exited; inspect .logs/warm-host-smoke.log')
                    try:
                        with opener.open(env['CHATGPT_WEB_ORIGIN']+'/bridge/status', timeout=2) as response:
                            status = json.load(response)
                        if status['snapshot']:
                            break
                    except OSError:
                        pass
                    time.sleep(.2)
                else:
                    raise RuntimeError('Host warmup timeout; inspect .logs/warm-host-smoke.log')
                ready = time.monotonic()-started
                time.sleep(5)
                before = cpu(proc.pid)
                result = subprocess.run(['node', str(ROOT/'scripts/smoke-warm-client.cjs')], cwd=work, env=env, capture_output=True, text=True, timeout=50)
                if result.returncode:
                    raise RuntimeError(result.stderr)
                after = cpu(proc.pid)
                native = subprocess.run(['node', str(ROOT/'scripts/smoke-native.cjs')], cwd=work, env=env, capture_output=True, text=True, timeout=50)
                if native.returncode:
                    raise RuntimeError(native.stderr)
                print(json.dumps({'hostReadySeconds':round(ready,3),'connectionCpuSeconds':round(after-before,3),
                                  'nativeChecks': [line for line in native.stdout.splitlines() if line.startswith('PASS:')],
                                  **json.loads(result.stdout)}))
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid,signal.SIGTERM)
                    try:
                        proc.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid,signal.SIGKILL)
                        proc.wait()


if __name__=='__main__':
    main()
