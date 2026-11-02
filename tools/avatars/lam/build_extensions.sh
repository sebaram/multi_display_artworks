#!/usr/bin/env bash
set -euo pipefail
runtime="${LAM_RUNTIME_ROOT:-$HOME/.local/share/metamuseum-lam}"
export CUDA_HOME="$runtime/env"
export CUB_HOME="$runtime/env/targets/x86_64-linux/include"
export TORCH_CUDA_ARCH_LIST=12.0
export MAX_JOBS=6
export FORCE_CUDA=1
export CC="$runtime/env/bin/x86_64-conda-linux-gnu-gcc"
export CXX="$runtime/env/bin/x86_64-conda-linux-gnu-g++"
export LD_LIBRARY_PATH="/usr/lib/wsl/lib:$runtime/env/lib:${LD_LIBRARY_PATH:-}"
wheel_headers="$(python -c 'import pathlib,site; print(":".join(str(p) for root in site.getsitepackages() for p in pathlib.Path(root).glob("nvidia/*/include")))')"
export CPATH="$wheel_headers:${CPATH:-}"
python -m pip install --no-build-isolation --no-deps "$runtime/sources/pytorch3d"
python -m pip install --no-build-isolation --no-deps "$runtime/sources/diff-gaussian-rasterization"
python -m pip install --no-build-isolation --no-deps "$runtime/sources/nvdiffrast"
python -c 'import torch; import pytorch3d._C, diff_gaussian_rasterization, nvdiffrast.torch; print("LAM CUDA extension imports: OK")'
