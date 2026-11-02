#!/usr/bin/env bash
# Run only inside the isolated WSL environment, never the backend interpreter.
set -euo pipefail
runtime="${LAM_RUNTIME_ROOT:-$HOME/.local/share/metamuseum-lam}"
project="$(cd "$(dirname "$0")/../../.." && pwd)"
export CUDA_HOME="$runtime/env"
export CC="$runtime/env/bin/x86_64-conda-linux-gnu-gcc"
export CXX="$runtime/env/bin/x86_64-conda-linux-gnu-g++"
export TORCH_CUDA_ARCH_LIST=12.0 MAX_JOBS=6 TORCH_COMPILE_DISABLE=1
export OMP_NUM_THREADS=8 OPENBLAS_NUM_THREADS=8 TORCHINDUCTOR_COMPILE_THREADS=1
export LD_LIBRARY_PATH="/usr/lib/wsl/lib:$runtime/env/lib:${LD_LIBRARY_PATH:-}"
export CPATH="$runtime/env/targets/x86_64-linux/include:$("$runtime/env/bin/python" -c 'import pathlib,site; print(":".join(str(p) for root in site.getsitepackages() for p in pathlib.Path(root).glob("nvidia/*/include")))'):${CPATH:-}"
exec "$project/FLAME/lam/bin/micromamba" run -r "$runtime/mamba-root" -p "$runtime/env" "$@"
