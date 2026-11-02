"""Download integrity-pinned official LAM assets into ignored local research storage."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tarfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3] / 'FLAME' / 'lam'
ASSETS_REVISION = '284d3198e8a89cefba386ef83cb5f19034ff3910'
MODEL_REVISION = 'a710cd3c40c86ffe3fc572e895ed12f3ead47289'
FILES = [
    ('3DAIGC/LAM-20K', MODEL_REVISION, 'model.safetensors', 2356556212, 'f527e6e78fd9743aad95cb15b221b864d8b6d356c1d174c0ffad5d74b9a95925'),
    ('3DAIGC/LAM-assets', ASSETS_REVISION, 'LAM_assets.tar', 297328640, 'f8853a6678df2e08f4c27b3ed8ae625d29bc64500330b0bfebf45e64ff5af78f'),
    ('3DAIGC/LAM-assets', ASSETS_REVISION, 'LAM_human_model.tar', 122787840, 'f8a1e10301937ac9d6169bf46d1bb9a1e73725a31e380f67d5fca3f12f92ef24'),
    ('3DAIGC/LAM-assets', ASSETS_REVISION, 'thirdparty_models.tar', 969072640, '2ac5eba7c1abca0ab6c682ad900ddb8819b713506043b04874599c82572931c8'),
    ('3DAIGC/LAM-assets', ASSETS_REVISION, 'thirdparties.tar', 1162854400, '86b5b7dafb858e4cb14764ac63317e9d7e6923ebbab1abf70b8679163f0eb339'),
]
EXPORT_FILES = [
    ('https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/data/LAM', 'upstream-export-guide', 'sample_oac.tar', 6995285, '5b69908f159ad9c8b966c2d4b24f9c5a0f84f3535dbf6100ed269f708886a19d'),
    ('https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/data/LAM', 'upstream-export-guide', 'fbx-2020.3.4-cp310-cp310-manylinux1_x86_64.whl', 34808427, 'e3ecbad4f2364a8a02a46897109b9ad1a7c8931e1e60e4fe8f64ea2bba3e5252'),
]


def verified(path, size, expected):
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open('rb') as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024**2), b''):
            digest.update(chunk)
        return digest.hexdigest() == expected


def download(entry):
    repository, revision, name, size, digest = entry
    cache = ROOT / 'cache'
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / name
    if verified(target, size, digest):
        print(f'{name}: verified cache', flush=True)
        return target
    partial = target.with_suffix(target.suffix + '.part')
    offset = partial.stat().st_size if partial.exists() else 0
    if offset == size and verified(partial, size, digest):
        partial.replace(target)
        return target
    headers = {'User-Agent': 'MetaMuseum-local-LAM-research'}
    if 0 < offset < size:
        headers['Range'] = f'bytes={offset}-'
    url = f'{repository}/{name}' if repository.startswith('https://') else f'https://huggingface.co/{repository}/resolve/{revision}/{name}'
    with urlopen(Request(url, headers=headers), timeout=60) as response:
        append = response.status == 206 and response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')
        done = offset if append else 0
        reported = done // (128 * 1024**2)
        with partial.open('ab' if append else 'wb') as output:
            while chunk := response.read(1024**2):
                output.write(chunk)
                done += len(chunk)
                if done > size:
                    raise ValueError(f'{name}: response exceeds expected size')
                if done // (128 * 1024**2) != reported:
                    reported = done // (128 * 1024**2)
                    print(f'{name}: {done // 1024**2}/{size // 1024**2} MiB', flush=True)
    if not verified(partial, size, digest):
        raise ValueError(f'{name}: integrity mismatch; not installing')
    partial.replace(target)
    print(f'{name}: SHA-256 verified', flush=True)
    return target


def main():
    with ThreadPoolExecutor(max_workers=2) as pool:
        paths = list(pool.map(download, FILES + EXPORT_FILES))
    upstream = ROOT / 'upstream'
    if not (upstream / 'lam/models/modeling_lam.py').is_file():
        raise RuntimeError('Clone the pinned upstream LAM source before installing assets')
    for path in paths[1:5]:
        with tarfile.open(path) as archive:
            archive.extractall(upstream, filter='data')
    with tarfile.open(paths[5]) as archive:
        archive.extractall(upstream / 'assets', filter='data')
    destination = upstream / 'model_zoo/lam_models/releases/lam/lam-20k/step_045500'
    destination.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copyfile(paths[0], destination / paths[0].name)
    (ROOT / 'asset-provenance.json').write_text(json.dumps(FILES + EXPORT_FILES, indent=2)+'\n', encoding='utf8')
    print('Installed private local assets. Third-party and weight licenses remain separate.', flush=True)


if __name__ == '__main__':
    main()
