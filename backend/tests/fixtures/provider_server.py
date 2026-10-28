"""A real loopback upstream: records provider wire data, never contacts the internet."""
import json
import socket
import ssl
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import StreamRequestHandler, ThreadingTCPServer
from pathlib import Path


@contextmanager
def provider_server(result=None, *, mode='success', model_text=None, tls=False):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            entry = {'path': self.path, 'headers': dict(self.headers), 'body': body, 'peer_closed': threading.Event()}
            requests.append(entry)
            if mode == 'header_trickle':
                try:
                    self.wfile.write(b'HTTP/1.1 200 OK\r\nX-Unfinished: ')
                    self.wfile.flush()
                    for _ in range(100):
                        self.wfile.write(b'x')
                        self.wfile.flush()
                        time.sleep(.02)
                except (OSError, ValueError):
                    entry['peer_closed'].set()
                return
            if mode == 'disconnect':
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            if mode == 'timeout':
                time.sleep(.25)
            if mode == 'error':
                self.send_response(503)
                self.end_headers()
                self.wfile.write(b'upstream-secret-must-not-escape')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            if mode == 'invalid':
                payload = b'not json'
            elif self.path.endswith('/audio/transcriptions'):
                payload = json.dumps({'text': 'local transcription'}).encode()
            elif self.path.endswith('/messages'):
                payload = json.dumps({'content': [{'type': 'text', 'text': model_text if model_text is not None else json.dumps(result)}]}).encode()
            else:
                payload = json.dumps({'choices': [{'message': {'content': model_text if model_text is not None else json.dumps(result)}}]}).encode()
            try:
                if mode == 'trickle':
                    for byte in payload:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        time.sleep(.01)
                else:
                    self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                entry['peer_closed'].set()

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    if tls:
        # Original test-only self-signed certificate/key, never a deployment credential.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        here = Path(__file__).parent
        context.load_cert_chain(here/'localhost.cert.pem', here/'localhost.key.pem')
        server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'{"https" if tls else "http"}://127.0.0.1:{server.server_port}/v1', requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@contextmanager
def smtp_server():
    deliveries = []

    class Handler(StreamRequestHandler):
        def handle(self):
            self.wfile.write(b'220 local-fixture ESMTP\r\n')
            data_mode, body = False, bytearray()
            for line in self.rfile:
                if data_mode:
                    if line == b'.\r\n':
                        deliveries.append(bytes(body))
                        self.wfile.write(b'250 queued locally\r\n')
                        data_mode = False
                    else:
                        body.extend(line)
                elif line.upper().startswith(b'DATA'):
                    data_mode = True
                    self.wfile.write(b'354 send data\r\n')
                elif line.upper().startswith(b'QUIT'):
                    self.wfile.write(b'221 bye\r\n')
                    return
                else:
                    self.wfile.write(b'250 local-fixture\r\n')

    server = ThreadingTCPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1], deliveries
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)


@contextmanager
def stalled_transport_server(phase):
    """Hold a real TLS handshake or request upload until the client closes it."""
    peer_closed = threading.Event()

    class Handler(StreamRequestHandler):
        def handle(self):
            self.request.settimeout(2)
            try:
                received = self.request.recv(65536)
                if phase == 'upload':
                    while b'\r\n\r\n' not in received:
                        received += self.request.recv(4096)
                    time.sleep(.25)
                while self.request.recv(65536):
                    pass
                peer_closed.set()
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                peer_closed.set()

    server = ThreadingTCPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        scheme = 'https' if phase == 'tls' else 'http'
        yield f'{scheme}://127.0.0.1:{server.server_address[1]}/v1', peer_closed
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
