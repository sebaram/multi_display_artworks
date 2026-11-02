"""Materialize the verified official model's legacy numeric containers offline."""
import hashlib
from pathlib import Path
import pickle
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from export_gaussian_avatar import LegacyArray, LegacyCSC, ModelUnpickler


def prepare(path):
    original = path.with_suffix('.original.pkl')
    if not original.exists():
        path.rename(original)
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    if digest != '8fb1af0db1abb51053ead8fd1f2624a63d01c9602f4a4fb4ea23bd2c82017fa0':
        raise ValueError('Expected the original model from the integrity-pinned LAM human assets')
    with original.open('rb') as source:
        data = ModelUnpickler(source, encoding='latin1').load()
    for name, value in data.items():
        if isinstance(value, LegacyCSC):
            data[name] = value.dense()
        elif isinstance(value, LegacyArray):
            data[name] = value.x
    with path.open('wb') as target:
        pickle.dump(data, target, protocol=4)
    print('Original FLAME source SHA256:', digest)


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
