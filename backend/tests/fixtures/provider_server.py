"""A real loopback upstream: records provider wire data, never contacts the internet."""
import json
import socket
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import StreamRequestHandler, ThreadingTCPServer


@contextmanager
def provider_server(result=None, *, mode='success', model_text=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            requests.append({'path': self.path, 'headers': dict(self.headers), 'body': body})
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
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/v1', requests
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
