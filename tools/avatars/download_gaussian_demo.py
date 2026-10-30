"""Fetch the pinned official research demo into the ignored local FLAME cache."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

REVISION = '29b0021308d45c6dce0b522044a4893e189c7a23'
REPOSITORY = 'ShenhanQian/GaussianAvatars'
FILES = ['media/306/point_cloud.ply', 'media/306/flame_param.npz',
         'flame_model/flame.py', 'flame_model/assets/flame/head_template_mesh.obj', 'LICENSE.md']
ROOT = Path(__file__).resolve().parents[2] / 'FLAME' / 'upstream'


def get(url):
    return urlopen(Request(url, headers={'User-Agent': 'MetaMuseum-local-research-demo'}), timeout=120)


def git_hash(path):
    digest = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    with get(f'https://api.github.com/repos/{REPOSITORY}/git/trees/{REVISION}?recursive=1') as response:
        entries = {entry['path']: entry for entry in json.load(response)['tree']}

    def download(name):
        info = entries[name]
        target = ROOT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.stat().st_size == info['size'] and git_hash(target) == info['sha']:
            return f'{name}: verified cached {info["size"]} bytes'
        temporary = target.with_suffix(target.suffix + '.partial')
        with get(f'https://raw.githubusercontent.com/{REPOSITORY}/{REVISION}/{name}') as response, temporary.open('wb') as output:
            for chunk in iter(lambda: response.read(1024 * 1024), b''):
                output.write(chunk)
        if temporary.stat().st_size != info['size'] or git_hash(temporary) != info['sha']:
            raise ValueError(f'Upstream integrity mismatch: {name}')
        temporary.replace(target)
        return f'{name}: verified {info["size"]} bytes'

    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(download, FILES):
            print(result, flush=True)
    print('Local research cache only. Model and subject redistribution rights are separate.', flush=True)


if __name__ == '__main__':
    main()
