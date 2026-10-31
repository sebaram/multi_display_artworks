"""Serve only generated synthetic benchmark assets with cross-origin access."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=3600')
        super().end_headers()

    def log_message(self, *_):
        pass

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / 'output/playwright/performance/fixtures'
    ThreadingHTTPServer(('127.0.0.1', 8767), partial(Handler, directory=str(root))).serve_forever()
