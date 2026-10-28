"""Generate tiny deterministic original media; generated binaries are gitignored."""
import json
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

HERE=Path(__file__).resolve().parent
OUT=HERE/'media'

def png_chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)

def generate():
    OUT.mkdir(exist_ok=True)
    # Four quadrants make orientation/UV errors visible in a screenshot.
    rows=[]
    for y in range(128):
        rows.append(b'\x00'+b''.join(bytes((255 if x<64 else 30,180 if y<64 else 40,60 if x<64 else 240)) for x in range(128)))
    (OUT/'image.png').write_bytes(b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>2I5B',128,128,8,2,0,0,0))+png_chunk(b'IDAT',zlib.compress(b''.join(rows)))+png_chunk(b'IEND',b''))
    binary=struct.pack('<9f',-.5,0,0,.5,0,0,0,1,0)
    gltf={'asset':{'version':'2.0','generator':'metamuseum synthetic migration fixture'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':0}]}],'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[1,.35,.1,1],'metallicFactor':0,'roughnessFactor':1}}],'buffers':[{'byteLength':len(binary)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(binary),'target':34962}],'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-.5,0,0],'max':[.5,1,0]}]}
    encoded=json.dumps(gltf,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    body=struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    (OUT/'triangle.glb').write_bytes(struct.pack('<4sII',b'glTF',2,12+len(body))+body)
    cloud=bytearray()
    for x in range(8):
        for y in range(8):
            for z in range(8):
                cloud.extend(struct.pack('<6f8B',(x-3.5)*.08,(y-3.5)*.08,(z-3.5)*.08,.035,.035,.035,40+x*25,40+y*25,40+z*25,220,255,128,128,128))
    (OUT/'cloud.splat').write_bytes(cloud)
    for state in ('allowed','blocked'):
        (OUT/f'frame-{state}.html').write_text(f'<!doctype html><html lang="en"><title>Frame {state}</title><body style="background:#123;color:white"><h1>Migration frame {state}</h1><button onclick="this.textContent=\'Clicked\'">Interact</button></body></html>',encoding='utf8')
    exe=shutil.which('ffmpeg')
    if not exe:
        import imageio_ffmpeg
        exe=imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([exe,'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-g','48','-c:a','aac','-movflags','+faststart',str(OUT/'video.mp4')],check=True)
    subprocess.run([exe,'-hide_banner','-loglevel','error','-y','-i',str(OUT/'video.mp4'),'-c','copy','-hls_time','2','-hls_list_size','0','-hls_segment_filename',str(OUT/'segment%02d.ts'),str(OUT/'playlist.m3u8')],check=True)
    print(f'Generated original PNG/GLB/splat/MP4/HLS/HTML in {OUT}')

if __name__=='__main__':generate()
