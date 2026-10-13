"""Keep full native logs on disk and concise, actionable status in the terminal."""
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit


class Console:
    def __init__(self, logfile, debug=False):
        self.logfile, self.debug, self.seen = logfile, debug, set()

    def line(self, text):
        if self.debug or text.startswith(('[chatgpt-web]', '[chatgpt-webui]')):
            return text.rstrip()
        # Optional integrations and runtime notices remain in the private log.
        if any(value in text for value in ('Registration response error message:', 'MaxListenersExceededWarning',
                                          'DeprecationWarning', 'refresh_local_remote_control_client_id_failed')):
            return None
        if re.match(r'^\s+(?:at |\.\.\.)', text):
            return None
        if '[Statsig]' in text and re.search(r'error|failed|aborted', text, re.I):
            key, message = 'statsig', '配置服务请求失败；若初始化未完成，请检查宿主网络。'
        elif 'ssl_client_socket_impl' in text and 'handshake failed' in text:
            key, message = 'tls', '宿主出现 TLS 连接失败；请检查代理和网络。'
        elif re.search(r'\b(?:fatal|uncaught|failed)\b|\berror\s*:|\berrorMessage=', text, re.I):
            def safe_url(match):
                try:
                    url = urlsplit(match.group())
                    return urlunsplit((url.scheme, url.hostname or '', url.path, '', ''))
                except ValueError:
                    return '[URL]'
            message = '宿主错误：' + re.sub(r'https?://\S+', safe_url, text.strip())[:300]
            key = message
        else:
            return None
        if key in self.seen:
            return None
        self.seen.add(key)
        return f'[chatgpt-web] {message} 详情：{self.logfile}'


class Log:
    def __init__(self, path, limit=20 * 1024 * 1024):
        self.path, self.limit = Path(path), limit
        self.stream = None
        self.open()

    def open(self):
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.fchmod(fd, 0o600)
        self.size = os.fstat(fd).st_size
        self.stream = os.fdopen(fd, 'ab')

    def write(self, text):
        data = text.encode('utf-8')
        if self.size + len(data) > self.limit and self.size:
            self.stream.close()
            for number in (2, 1):
                old = self.path.with_name(self.path.name + f'.{number}')
                if old.exists():
                    old.replace(self.path.with_name(self.path.name + f'.{number + 1}'))
            self.path.replace(self.path.with_name(self.path.name + '.1'))
            self.open()
        self.stream.write(data)
        self.stream.flush()
        self.size += len(data)

    def close(self):
        self.stream.close()


def run(arguments, lock_fd):
    mode = os.environ.get('CHATGPT_WEB_LOG_LEVEL', 'normal')
    if mode not in ('normal', 'debug'):
        raise RuntimeError('CHATGPT_WEB_LOG_LEVEL must be normal or debug')
    path = Path(os.environ['CHATGPT_WEB_ROOT']) / '.logs/host.log'
    log = Log(path)
    console = Console(path, debug=mode == 'debug')
    print(f'[chatgpt-web] 正在启动宿主；详细日志：{path}', flush=True)
    proc = None
    stopped = False
    handlers = {}
    def stop(signum, _frame):
        nonlocal stopped
        stopped = True
        if proc is not None and proc.poll() is None:
            os.killpg(proc.pid, signum)
    try:
        proc = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors='replace', bufsize=1,
                                pass_fds=(lock_fd,), start_new_session=True)
        for sig in (signal.SIGINT, signal.SIGTERM):
            handlers[sig] = signal.signal(sig, stop)
        for line in proc.stdout:
            log.write(line)
            rendered = console.line(line)
            if rendered:
                print(rendered, flush=True)
        code = proc.wait()
        if code and not stopped:
            print(f'[chatgpt-web] 宿主异常退出（{code}），请查看 {path}', file=sys.stderr, flush=True)
        return code if code >= 0 else 128 - code
    finally:
        if proc is not None and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        log.close()
