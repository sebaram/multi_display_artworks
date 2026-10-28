"""Managed FFmpeg HLS conversion. All methods run in worker threads."""
import queue
import re
import shutil
import subprocess
import threading
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException

SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
SAFE_SEGMENT = re.compile(r'^segment[0-9]+\.ts$')


def validate_stream_id(value):
    if (not isinstance(value, str) or not SAFE_ID.fullmatch(value)
            or re.fullmatch(r'CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]', value, re.IGNORECASE)):
        raise HTTPException(400, 'invalid_stream_id')
    return value


def redact(line):
    # FFmpeg may print input credentials, query tokens, and local paths.
    return re.sub(r'(?:rtsp|rtsps|https?|file)://\S+', '[source]', line)[:500]


@dataclass
class Session:
    process: subprocess.Popen
    path: Path
    kind: str
    mime: str = ''
    next_index: int = 0
    chunks: queue.Queue | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    errors: deque = field(default_factory=lambda: deque(maxlen=8))
    threads: list = field(default_factory=list)


class StreamManager:
    def __init__(self, root, ffmpeg='ffmpeg', *, max_streams=8):
        self.root = Path(root).resolve()
        self.ffmpeg = ffmpeg
        self.max_streams = max_streams
        self.sessions = {}
        self.lock = threading.RLock()

    def _path(self, stream_id):
        path = (self.root / validate_stream_id(stream_id)).resolve()
        if not path.is_relative_to(self.root) or path == self.root:
            raise HTTPException(400, 'invalid_stream_path')
        return path

    def _spawn(self, stream_id, inputs, *, kind, mime=''):
        path = self._path(stream_id)
        if stream_id in self.sessions:
            raise HTTPException(409, 'stream_already_exists')
        if len(self.sessions) >= self.max_streams:
            raise HTTPException(429, 'stream_limit_exceeded')
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True)
        command = [self.ffmpeg, '-hide_banner', '-loglevel', 'warning', '-nostats', '-y', *inputs,
            '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-g', '30', '-sc_threshold', '0',
            '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '5',
            '-hls_flags', 'delete_segments+temp_file+independent_segments',
            '-hls_segment_filename', str(path/'segment%06d.ts'), str(path/'playlist.m3u8')]
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE if kind == 'phone' else subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, shell=False,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except OSError:
            shutil.rmtree(path)
            raise HTTPException(503, 'ffmpeg_unavailable') from None
        session = Session(process, path, kind, mime=mime)
        self.sessions[stream_id] = session

        def read_errors():
            for raw in iter(lambda: process.stderr.readline(8192), b''):
                session.errors.append(redact(raw.decode(errors='replace').strip()))
            process.stderr.close()

        reader = threading.Thread(target=read_errors, daemon=True, name='ffmpeg-diagnostics')
        reader.start()
        session.threads.append(reader)
        if kind == 'phone':
            session.chunks = queue.Queue(maxsize=3)

            def feed():
                try:
                    while True:
                        data = session.chunks.get()
                        if data is None:
                            break
                        process.stdin.write(data)
                        process.stdin.flush()
                except (OSError, ValueError):
                    session.errors.append('phone_input_closed')
                finally:
                    try:
                        process.stdin.close()
                    except OSError:
                        pass

            writer = threading.Thread(target=feed, daemon=True, name='ffmpeg-phone-input')
            writer.start()
            session.threads.append(writer)
        return self.status(stream_id)

    def start_rtsp(self, stream_id, url):
        try:
            parsed = urlsplit(url)
            valid = (parsed.scheme in {'rtsp', 'rtsps'} and parsed.hostname and len(url) <= 2048
                     and not any(c.isspace() or ord(c) < 32 for c in url))
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise HTTPException(422, 'invalid_rtsp_url')
        with self.lock:
            return self._spawn(stream_id, ['-rtsp_transport', 'tcp', '-timeout', '5000000', '-i', url], kind='rtsp')

    def start_source(self, stream_id, source, *, realtime=False):
        """Internal source entry point used by deterministic FFmpeg fixtures."""
        with self.lock:
            return self._spawn(stream_id, [*(['-re'] if realtime else []), '-i', source], kind='source')

    def push(self, stream_id, data, index, mime):
        validate_stream_id(stream_id)
        if not data or len(data) > 16*1024*1024 or isinstance(index, bool) or not isinstance(index, int) or index < 0:
            raise HTTPException(422, 'invalid_stream_chunk')
        mime = mime.split(';')[0].lower()
        with self.lock:
            session = self.sessions.get(stream_id)
            if session is None:
                if index != 0:
                    raise HTTPException(409, 'first_chunk_required')
                container = ('webm' if data.startswith(b'\x1aE\xdf\xa3') else
                             'mp4' if len(data) >= 12 and data[4:8] == b'ftyp' else None)
                if container is None or mime not in {'video/'+container, 'application/octet-stream'}:
                    raise HTTPException(415, 'unsupported_phone_container')
                self._spawn(stream_id, ['-fflags', '+genpts', '-probesize', '32768', '-analyzeduration', '0',
                    '-f', 'matroska' if container == 'webm' else 'mp4', '-i', 'pipe:0'], kind='phone', mime=mime)
                session = self.sessions[stream_id]
        with session.lock:
            if session.kind != 'phone' or session.mime != mime:
                raise HTTPException(409, 'stream_input_mismatch')
            if index != session.next_index:
                raise HTTPException(409, 'stream_chunk_out_of_order')
            if session.process.poll() is not None:
                raise HTTPException(502, 'stream_conversion_failed')
            try:
                session.chunks.put(data, timeout=1)
            except queue.Full:
                raise HTTPException(429, 'stream_input_backpressure') from None
            session.next_index += 1
        return {'status': 'ok', 'idx': index, 'url': f'/stream/playlist/{stream_id}'}

    def finish_input(self, stream_id):
        with self.lock:
            session = self.sessions.get(validate_stream_id(stream_id))
        if session and session.chunks:
            try:
                session.chunks.put(None, timeout=1)
            except queue.Full:
                raise HTTPException(429, 'stream_input_backpressure') from None

    def status(self, stream_id):
        path = self._path(stream_id)
        session = self.sessions.get(stream_id)
        has_playlist = (path/'playlist.m3u8').is_file()
        running = bool(session and session.process.poll() is None)
        return dict(stream_id=stream_id, has_playlist=has_playlist, ffmpeg_running=running,
                    url=f'/stream/playlist/{stream_id}' if has_playlist else None,
                    state='running' if running else 'stopped',
                    diagnostics=list(session.errors) if session and not running else [])

    def list(self):
        with self.lock:
            return [self.status(name) for name in self.sessions]

    def playlist(self, stream_id):
        path = self._path(stream_id)/'playlist.m3u8'
        try:
            content = path.read_text(encoding='utf8')
        except FileNotFoundError:
            raise HTTPException(404, 'stream_not_ready') from None
        result = []
        for line in content.splitlines():
            if line and not line.startswith('#'):
                if not SAFE_SEGMENT.fullmatch(line):
                    raise HTTPException(502, 'invalid_stream_playlist')
                line = f'/stream/segment/{stream_id}/{line}'
            result.append(line)
        return '\n'.join(result)+'\n'

    def segment(self, stream_id, name):
        if not SAFE_SEGMENT.fullmatch(name):
            raise HTTPException(400, 'invalid_segment')
        root = self._path(stream_id)
        path = (root/name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, 'segment_not_found')
        return path

    def stop(self, stream_id):
        path = self._path(stream_id)
        with self.lock:
            session = self.sessions.get(stream_id)
            if session:
                process = session.process
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
                if session.chunks:
                    try:
                        session.chunks.put_nowait(None)
                    except queue.Full:
                        pass
                for thread in session.threads:
                    thread.join(timeout=2)
                if any(thread.is_alive() for thread in session.threads):
                    raise RuntimeError('stream_worker_did_not_stop')
                del self.sessions[stream_id]
            if path.exists():
                shutil.rmtree(path)
        return {'status': 'stopped'}

    def close(self):
        for name in list(self.sessions):
            self.stop(name)
