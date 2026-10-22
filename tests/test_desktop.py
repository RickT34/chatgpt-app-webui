"""Desktop updates exercise real package extraction and publication in a temp repo."""
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', ROOT / 'scripts/bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def asar(version):
    package = json.dumps({'version': version}).encode()
    header = json.dumps({'files': {'package.json': {'offset': '0', 'size': len(package)}}}).encode()
    padded = (4 + len(header) + 3) // 4 * 4
    return struct.pack('<4I', 4, padded + 4, padded, len(header)) + header + b'\0' * (padded - 4 - len(header)) + package


def app(directory, version):
    (directory / 'resources').mkdir(parents=True)
    (directory / 'resources/app.asar').write_bytes(asar(version))
    (directory / 'ChatGPT').write_text(f'binary {version}')
    (directory / 'resources/extra').write_text(f'resource {version}')
    return directory


def deb(path, version):
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode='w:xz') as archive:
        for name, data in {'ChatGPT': f'binary {version}'.encode(), 'resources/app.asar': asar(version)}.items():
            item = tarfile.TarInfo('./usr/lib/chatgpt/' + name)
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    data = payload.getvalue()
    header = f'{"data.tar.xz/":<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n'.encode()
    path.write_bytes(b'!<arch>\n' + header + data)
    return path


def index(version='26.1016.61520', arch='arm64', digest='a' * 64):
    return (f'Package: chatgpt\nVersion: {version}\nArchitecture: {arch}\n'
            f'Filename: pool/main/c/chatgpt/chatgpt_{version}_{arch}.deb\nSHA256: {digest}\n\n')


class ReleaseIndexTests(unittest.TestCase):
    def test_selects_newest_numeric_version_for_this_architecture(self):
        packages = index('26.930.21537') + index(arch='amd64') + index() + index('26.1007.21434')
        self.assertEqual(bootstrap.latest_desktop(packages, 'arm64')['version'], '26.1016.61520')

    def test_rejects_untrusted_path_missing_digest_and_wrong_architecture(self):
        for packages in (index().replace('pool/main/', '../pool/main/'),
                         index().replace('a' * 64, 'bad'), index(arch='amd64')):
            with self.subTest(packages=packages), self.assertRaises(RuntimeError):
                bootstrap.latest_desktop(packages, 'arm64')


class DesktopTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.addCleanup(os.chdir, Path.cwd())
        self.root = Path(temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(bootstrap, 'ROOT', self.root).start()
        patch.dict(os.environ, {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}, clear=True).start()
        patch.object(bootstrap, 'architecture', return_value=('arm64', 'arm64')).start()
        patch.object(bootstrap, 'check_libraries').start()
        patch.object(bootstrap.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 20 * 1024**3})()).start()
        self.current = app(self.root / 'system-app', '26.1007.21434')
        (self.root / '.runtime/resources').mkdir(parents=True)
        (self.root / '.runtime/ChatGPT').write_text('old runtime')
        (self.root / '.runtime/resources/old-only').write_text('must disappear on update')
        (self.root / 'prepare-manifest.json').write_text('{"old": true}\n')
        (self.root / '.profile').mkdir()
        (self.root / '.profile/session').write_text('keep login')
        (self.root / '.logs').mkdir()
        self.lock = (self.root / '.logs/instance.lock').open('a')
        self.addCleanup(self.lock.close)
        # The fixture builder is a subprocess, using the same env/output contract
        # as prepare.py, so publication tests do not mock filesystem operations.
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/prepare.py').write_text('''
import os, pathlib, json
stage = pathlib.Path(os.environ['CHATGPT_WEB_PREPARE_DIR'])
source = pathlib.Path(os.environ['CHATGPT_APP_DIR'])
(stage / '.runtime').mkdir()
(stage / '.runtime/ChatGPT').write_bytes((source / 'ChatGPT').read_bytes())
(stage / 'prepare-manifest.json').write_text(json.dumps({'source': str(source / 'resources/app.asar')}))
''')
        self.package = deb(self.root / 'new.deb', '26.1016.61520')
        self.packages = self.root / 'Packages'
        self.packages.write_text(index(digest=bootstrap.sha256(self.package)))
        self.download = patch.object(bootstrap, 'download', side_effect=self.fake_download).start()

    def fake_download(self, url, target, digest=None):
        if url.endswith('/Packages'):
            return self.packages
        if digest != bootstrap.sha256(self.package):
            raise RuntimeError('SHA-256 mismatch')
        return self.package

    def update(self):
        bootstrap.switch_desktop('update', self.current, True, self.lock.fileno())

    def assert_original(self):
        self.assertEqual((self.root / '.runtime/ChatGPT').read_text(), 'old runtime')
        self.assertEqual((self.root / 'prepare-manifest.json').read_text(), '{"old": true}\n')
        self.assertFalse((self.root / '.deps/desktop-state.json').exists())
        self.assertEqual((self.root / '.profile/session').read_text(), 'keep login')

    def test_update_persists_selection_and_snapshots_system_source(self):
        self.update()
        state = bootstrap.desktop_state()
        self.assertEqual(state['current']['version'], '26.1016.61520')
        self.assertEqual(state['previous']['version'], '26.1007.21434')
        self.assertEqual(bootstrap.ensure_app(False, True), Path(state['current']['source']))
        self.assertEqual((self.root / '.runtime/ChatGPT').read_text(), 'binary 26.1016.61520')
        self.assertFalse((self.root / '.runtime/resources/old-only').exists())
        (self.current / 'resources/app.asar').write_bytes(b'system upgrade')
        saved = bootstrap.validate_release(state['previous'])
        self.assertEqual((saved / 'resources/extra').read_text(), 'resource 26.1007.21434')
        self.assertEqual((self.root / '.profile/session').read_text(), 'keep login')

    def test_rollback_restores_previous_source_offline_and_consumes_history(self):
        self.update()
        self.download.side_effect = AssertionError('rollback must not download')
        bootstrap.switch_desktop('rollback', self.current, False, self.lock.fileno())
        self.assertEqual((self.root / '.runtime/ChatGPT').read_text(), 'binary 26.1007.21434')
        self.assertEqual(bootstrap.desktop_state()['current']['version'], '26.1007.21434')
        self.assertIsNone(bootstrap.desktop_state()['previous'])
        self.assertEqual(bootstrap.ensure_app(False, True), Path(bootstrap.desktop_state()['current']['source']))
        self.assertEqual((self.root / '.profile/session').read_text(), 'keep login')
        with self.assertRaisesRegex(RuntimeError, 'No previous'):
            bootstrap.switch_desktop('rollback', self.current, False, self.lock.fileno())

    def test_already_latest_preserves_previous_and_does_not_prepare(self):
        self.update()
        before = (self.root / '.deps/desktop-state.json').read_bytes()
        (self.root / 'scripts/prepare.py').write_text('raise RuntimeError("should not prepare")')
        bootstrap.switch_desktop('update', bootstrap.ensure_app(False, True), True, self.lock.fileno())
        self.assertEqual((self.root / '.deps/desktop-state.json').read_bytes(), before)

    def test_newer_installed_version_is_not_downgraded(self):
        self.packages.write_text(index('26.930.21537'))
        self.update()
        self.assert_original()

    def test_second_update_remembers_the_version_it_replaced(self):
        self.update()
        current = bootstrap.ensure_app(False, True)
        self.package = deb(self.root / 'newer.deb', '26.1020.10000')
        self.packages.write_text(index('26.1020.10000', digest=bootstrap.sha256(self.package)))
        bootstrap.switch_desktop('update', current, True, self.lock.fileno())
        self.assertEqual(bootstrap.desktop_state()['current']['version'], '26.1020.10000')
        self.assertEqual(bootstrap.desktop_state()['previous']['version'], '26.1016.61520')

    def test_declined_update_does_not_download_package_or_change_selection(self):
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='n'):
            with self.assertRaisesRegex(RuntimeError, 'Canceled'):
                bootstrap.switch_desktop('update', self.current, False, self.lock.fileno())
        self.assert_original()
        self.assertEqual(self.download.call_count, 1, 'only the package index may be fetched before approval')

    def test_main_dispatches_update_then_can_rollback_a_broken_current_source(self):
        # Use real Node dependency discovery, the actual main entry point and
        # the fixture prepare subprocess; no App process should be launched.
        for name in ('ws', 'capnweb'):
            module = self.root / 'node_modules' / name
            module.mkdir(parents=True)
            (module / 'index.js').write_text('module.exports = {};')
        lockfile = self.root / 'package-lock.json'
        lockfile.write_text('{}')
        (self.root / 'node_modules/.chatgpt-webui-lock').write_text(bootstrap.sha256(lockfile))
        local = self.root / f'.deps/chatgpt-{bootstrap.APP_VERSION}-arm64/usr/lib'
        local.mkdir(parents=True)
        (local / 'chatgpt').symlink_to(self.current, target_is_directory=True)
        bootstrap.main(['update', '--yes'])
        source = Path(bootstrap.desktop_state()['current']['source'])
        (source / 'resources/app.asar').unlink()
        self.download.side_effect = AssertionError('rollback must work offline')
        bootstrap.main(['rollback'])
        self.assertEqual((self.root / '.runtime/ChatGPT').read_text(), 'binary 26.1007.21434')
        self.assertEqual((self.root / '.profile/session').read_text(), 'keep login')

    def test_no_previous_version_fails_before_any_download(self):
        with self.assertRaisesRegex(RuntimeError, 'No previous'):
            bootstrap.main(['rollback'])
        self.download.assert_not_called()
        self.assert_original()

    def test_failed_download_preserves_runtime_and_history(self):
        self.packages.write_text(index(digest='b' * 64))
        with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
            self.update()
        self.assert_original()

    def test_failed_preparation_preserves_runtime_and_history(self):
        (self.root / 'scripts/prepare.py').write_text('raise SystemExit("unsupported desktop protocol")')
        with self.assertRaises(subprocess.CalledProcessError):
            self.update()
        self.assert_original()
        self.assertEqual(list(self.root.glob('.desktop-stage-*')), [])

    def test_failed_publication_restores_runtime_manifest_and_state(self):
        replace = Path.replace
        def fail_state(path, target):
            if path.name == 'desktop-state.json' and path.parent.name.startswith('.desktop-stage-'):
                raise OSError('publication failed')
            return replace(path, target)
        with patch.object(Path, 'replace', fail_state), self.assertRaisesRegex(OSError, 'publication failed'):
            self.update()
        self.assert_original()
        self.assertFalse((self.root / '.deps/desktop-transaction.json').exists())

    def test_interrupted_publication_is_recovered_before_startup(self):
        replace = Path.replace
        def interrupt(path, target):
            if path.name == 'prepare-manifest.json' and path.parent.name.startswith('.desktop-stage-'):
                raise KeyboardInterrupt()
            return replace(path, target)
        with patch.object(Path, 'replace', interrupt), patch.object(bootstrap, 'recover_desktop_switch'), self.assertRaises(KeyboardInterrupt):
            self.update()
        with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
            bootstrap.recover_desktop_switch(check=True)
        bootstrap.recover_desktop_switch()
        self.assert_original()
        bootstrap.recover_desktop_switch()  # Recovery is idempotent.

    def test_publication_preserves_docker_volume_symlinks(self):
        data = self.root / 'data'
        data.mkdir()
        (self.root / '.runtime').rename(data / '.runtime')
        (self.root / '.runtime').symlink_to(data / '.runtime')
        (self.root / 'prepare-manifest.json').rename(data / 'prepare-manifest.json')
        (self.root / 'prepare-manifest.json').symlink_to(data / 'prepare-manifest.json')
        self.update()
        self.assertTrue((self.root / '.runtime').is_symlink())
        self.assertTrue((self.root / 'prepare-manifest.json').is_symlink())
        self.assertEqual((data / '.runtime/ChatGPT').read_text(), 'binary 26.1016.61520')

    def test_running_app_blocks_update_before_download(self):
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with self.assertRaisesRegex(RuntimeError, 'already running'):
            bootstrap.main(['update', '--yes'])
        self.download.assert_not_called()
        self.assert_original()

    def test_invalid_combinations_and_explicit_override_do_not_download(self):
        for arguments in (['update', 'rollback'], ['update', '--check'], ['rollback', '--disable-gpu']):
            with self.subTest(arguments=arguments), self.assertRaisesRegex(RuntimeError, 'Usage'):
                bootstrap.main(arguments)
        with patch.dict(os.environ, {'CHATGPT_APP_DIR': str(self.current)}):
            with self.assertRaisesRegex(RuntimeError, 'Unset CHATGPT_APP_DIR'):
                bootstrap.main(['update'])
        self.download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
