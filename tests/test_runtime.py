import importlib.util
from pathlib import Path
import tempfile
import subprocess
import sys
import signal
import select
import fcntl
import os
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('web_runtime', ROOT/'scripts/runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def test_terminal_keeps_bridge_status_and_reports_errors_once(self):
        output = runtime.Console('/private/host.log')
        self.assertEqual(output.line('[chatgpt-web] ready\n'), '[chatgpt-web] ready')
        self.assertIsNone(output.line('[AppServerConnection] connected'))
        self.assertIsNone(output.line('Registration response error message: DEPRECATED_ENDPOINT'))
        self.assertIsNone(output.line('refresh_local_remote_control_client_id_failed Sign in'))
        message = output.line('ERROR [Statsig] networking error')
        self.assertIn('配置服务', message)
        self.assertIsNone(output.line('ERROR [Statsig] networking error'))
        self.assertIn('宿主错误', output.line('Error: bind failed'))
        self.assertIn('EADDRINUSE', output.line('Error: EADDRINUSE'))
        self.assertIsNone(output.line('    at internal/file.js:12'))
        sanitized = output.line('Fetch failed https://user:password@example.test/api?token=secret')
        self.assertNotIn('password', sanitized)
        self.assertNotIn('secret', sanitized)

    def test_supervisor_forwards_stop_and_preserves_exit_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / '.logs').mkdir()
            lock = root / 'instance.lock'
            fake = "import time;print('[chatgpt-web] ready',flush=True);time.sleep(60)"
            code = "import sys,fcntl;sys.path.insert(0,sys.argv[1]);from runtime import run;f=open(sys.argv[2],'a');fcntl.flock(f,fcntl.LOCK_EX);sys.exit(run([sys.executable,'-u','-c',sys.argv[3]],f.fileno()))"
            env = {**os.environ, 'CHATGPT_WEB_ROOT': str(root), 'CHATGPT_WEB_LOG_LEVEL': 'normal'}
            proc = subprocess.Popen([sys.executable, '-u', '-c', code, str(ROOT/'scripts'), str(lock), fake], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            try:
                output = b''
                while b'[chatgpt-web] ready' not in output:
                    self.assertTrue(select.select([proc.stdout], [], [], 5)[0], 'supervisor did not become ready')
                    chunk = os.read(proc.stdout.fileno(), 4096)
                    self.assertTrue(chunk, 'supervisor exited early')
                    output += chunk
                with lock.open('a') as check:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(check, fcntl.LOCK_EX | fcntl.LOCK_NB)
                proc.send_signal(signal.SIGTERM)
                rest, error = proc.communicate(timeout=5)
                self.assertEqual(proc.returncode, 143)
                self.assertNotIn(b'host exited', rest)
                with lock.open('a') as check:
                    fcntl.flock(check, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertIn('ready', (root/'.logs/host.log').read_text())
            finally:
                if proc.poll() is None:
                    proc.terminate();proc.communicate(timeout=5)

    def test_debug_preserves_native_lines(self):
        self.assertEqual(runtime.Console('file', True).line('raw failed output\n'), 'raw failed output')

    def test_rotated_log_keeps_raw_output_private(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'host.log'
            log = runtime.Log(path, limit=10)
            try:
                log.write('first failed\n')
                log.write('second\n')
                self.assertEqual(path.with_name('host.log.1').read_text(), 'first failed\n')
                self.assertEqual(path.read_text(), 'second\n')
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            finally:
                log.close()


if __name__ == '__main__':
    unittest.main()
