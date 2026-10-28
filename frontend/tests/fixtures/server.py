"""Local browser fixture origin: media ranges, embed policies and provider stubs."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MEDIA=Path(__file__).resolve().parent/'media'

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.glb':'model/gltf-binary','.splat':'application/octet-stream'}
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Accept-Ranges','bytes')
        if self.path.split('?')[0]=='/frame-blocked.html':
            self.send_header('X-Frame-Options','DENY')
            self.send_header('Content-Security-Policy',"frame-ancestors 'none'")
        super().end_headers()

    def do_GET(self):
        path=Path(self.translate_path(self.path))
        byte_range=self.headers.get('Range')
        if byte_range and path.is_file():
            import re
            match=re.fullmatch(r'bytes=(\d+)-(\d*)',byte_range)
            size=path.stat().st_size
            if not match or int(match[1])>=size:
                self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return
            start=int(match[1]);end=min(int(match[2]) if match[2] else size-1,size-1)
            if end<start:self.send_error(416);return
            self.send_response(206)
            self.send_header('Content-Type',self.guess_type(str(path)))
            self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length',str(end-start+1));self.end_headers()
            with path.open('rb') as stream:stream.seek(start);self.wfile.write(stream.read(end-start+1))
            return
        super().do_GET()

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length','0')))
        if self.path=='/v1/audio/transcriptions':
            response={'text':'Synthetic migration transcript'}
        elif self.path=='/v1/chat/completions':
            response={'choices':[{'message':{'content':json.dumps({'layout':[],'explanation':'Synthetic empty layout'})}}]}
        else:self.send_error(404);return
        payload=json.dumps(response).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)

if __name__=='__main__':
    if not (MEDIA/'video.mp4').exists():raise SystemExit('Run generate_media.py first')
    print('Synthetic fixture origin http://127.0.0.1:8766',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8766),partial(Handler,directory=str(MEDIA))).serve_forever()
