import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', ROOT / 'scripts/bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
    def test_host_renderer_selection_invalidates_prepared_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / '.runtime/resources').mkdir(parents=True)
            (root / '.runtime/ChatGPT').touch()
            (root / '.runtime/resources/app.asar').touch()
            (root / 'bridge').mkdir()
            source = root / 'source'
            manifest = {'host_renderer': 'minimal', 'source': str(source / 'resources/app.asar'),
                        'source_sha256': 'digest', 'patch_files': {}}
            (root / 'prepare-manifest.json').write_text(json.dumps(manifest))
            with patch.object(bootstrap, 'ROOT', root), patch.object(bootstrap, 'sha256', return_value='digest'):
                with patch.dict(os.environ, {'CHATGPT_WEB_HOST_RENDERER': 'minimal'}):
                    self.assertFalse(bootstrap.needs_prepare(source))
                with patch.dict(os.environ, {'CHATGPT_WEB_HOST_RENDERER': 'full'}):
                    self.assertTrue(bootstrap.needs_prepare(source))
        with patch.dict(os.environ, {'CHATGPT_WEB_HOST_RENDERER': 'invalid'}):
            with self.assertRaisesRegex(RuntimeError, 'minimal or full'):
                bootstrap.main(['--check'])

    def test_architecture(self):
        self.assertEqual(bootstrap.architecture('x86_64'), ('x64', 'amd64'))
        self.assertEqual(bootstrap.architecture('aarch64'), ('arm64', 'arm64'))
        with self.assertRaises(RuntimeError):
            bootstrap.architecture('riscv64')

    def test_confirmation(self):
        with patch('sys.stdin.isatty', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'interactive'):
                bootstrap.ask('download?')
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='n'):
            with self.assertRaisesRegex(RuntimeError, 'Canceled'):
                bootstrap.ask('download?')
        with self.assertRaisesRegex(RuntimeError, 'Check only'):
            bootstrap.ask('download?', yes=True, check=True)
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='yes'):
            bootstrap.ask('download?')

    def test_download_checksum_and_cached_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'archive'
            target.write_bytes(b'known')
            digest = hashlib.sha256(b'known').hexdigest()
            with patch('urllib.request.urlopen') as opener:
                bootstrap.download('https://example.com/archive', target, digest)
                opener.assert_not_called()
            response = io.BytesIO(b'corrupted')
            response.url = 'https://example.com/archive'
            with patch('shutil.which', return_value=None), patch('urllib.request.build_opener') as factory:
                factory.return_value.open.return_value = response
                with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                    bootstrap.download('https://example.com/archive', target, '0' * 64)
            self.assertEqual(target.read_bytes(), b'known')
            self.assertFalse(target.with_suffix('.part').exists())

    def test_safe_extract_rejects_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'bad.tar'
            output = Path(temporary) / 'output'
            output.mkdir()
            with tarfile.open(archive, 'w') as tar:
                item = tarfile.TarInfo('../escaped')
                item.size = 1
                tar.addfile(item, io.BytesIO(b'x'))
            with self.assertRaises(tarfile.FilterError):
                bootstrap.extract_tar(archive, output)
            self.assertFalse((output.parent / 'escaped').exists())

    def test_deb_extracts_only_app_not_system_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'output'
            output.mkdir()
            payload = io.BytesIO()
            with tarfile.open(fileobj=payload, mode='w:xz') as tar:
                for name in ('./usr/lib/chatgpt/ChatGPT', './etc/should-not-install'):
                    item = tarfile.TarInfo(name)
                    item.size = 3
                    tar.addfile(item, io.BytesIO(b'app'))
            data = payload.getvalue()
            header = f'{"data.tar.xz/":<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n'.encode()
            archive = Path(temporary) / 'app.deb'
            archive.write_bytes(b'!<arch>\n' + header + data)
            bootstrap.extract_deb(archive, output)
            self.assertTrue((output / 'usr/lib/chatgpt/ChatGPT').exists())
            self.assertFalse((output / 'etc').exists())

    def test_explicit_invalid_app_does_not_download(self):
        with patch.dict(os.environ, {'CHATGPT_APP_DIR': '/nonexistent/chatgpt-test'}), patch.object(bootstrap, 'download') as downloader:
            with self.assertRaisesRegex(RuntimeError, 'CHATGPT_APP_DIR'):
                bootstrap.ensure_app(True, False)
            downloader.assert_not_called()

    def test_native_library_error(self):
        result = subprocess.CompletedProcess([], 0, 'libgtk.so => not found', '')
        with patch('shutil.which', return_value='/usr/bin/ldd'), patch('subprocess.run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'libgtk.so'):
                bootstrap.check_libraries(Path('/example/app'))

    def test_python_override_fails_without_download(self):
        result = subprocess.run(['sh', str(ROOT / 'scripts/start.sh'), '--yes', '--check'],
                                env={**os.environ, 'CHATGPT_WEB_PYTHON': '/no/such/python'}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CHATGPT_WEB_PYTHON', result.stderr)


if __name__ == '__main__':
    unittest.main()
