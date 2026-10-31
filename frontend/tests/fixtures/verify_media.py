"""Verify generated formats, playback decoding and real HTTP embed/range policies."""
import hashlib
import json
import os
import shutil
import struct
import subprocess
import threading
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from server import Handler, MEDIA

ffmpeg = os.environ.get('FFMPEG_PATH') or shutil.which('ffmpeg')
if not ffmpeg:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(MEDIA)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
    files=sorted(x for x in MEDIA.iterdir() if x.is_file())
    manifest=[]
    for path in files:
        with urllib.request.urlopen(origin+'/'+path.name) as response:
            assert response.status==200
            assert response.headers['Access-Control-Allow-Origin']=='*'
            assert response.read()==path.read_bytes()
            if path.name=='frame-blocked.html':
                assert response.headers['X-Frame-Options']=='DENY'
                assert response.headers['Content-Security-Policy']=="frame-ancestors 'none'"
            elif path.name=='frame-allowed.html':assert not response.headers.get('X-Frame-Options')
        manifest.append({'path':path.name,'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    request=urllib.request.Request(origin+'/video.mp4',headers={'Range':'bytes=0-31'})
    with urllib.request.urlopen(request) as response:
        assert response.status==206 and len(response.read())==32
    glb=(MEDIA/'triangle.glb').read_bytes();assert struct.unpack('<4sII',glb[:12])==(b'glTF',2,len(glb))
    assert (MEDIA/'cloud.splat').stat().st_size==512*32
    assert (MEDIA/'alternate.splat').stat().st_size==343*32
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(MEDIA/'video.mp4'),'-f','null','-'],check=True)
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(MEDIA/'playlist.m3u8'),'-f','null','-'],check=True)
    (Path(__file__).parent/'media-manifest.json').write_text(json.dumps({'generator':'generate_media.py; configured, PATH or optional bundled FFmpeg','note':'Observed output hashes; cross-platform encoders may differ. No downloaded media.','files':manifest},indent=2)+'\n',encoding='utf8')
    print(f'PASS: {len(files)} local files served with CORS; blocked/allowed frame policies; MP4 range206; valid GLB/splat structures; MP4 and HLS fully decoded')
finally:
    server.shutdown();server.server_close()
