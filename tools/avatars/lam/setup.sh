#!/usr/bin/env bash
# WSL Ubuntu 24.04 / RTX Blackwell. No apt, system Python or system CUDA changes.
set -euo pipefail
project="$(cd "$(dirname "$0")/../../.." && pwd)"
runtime="${LAM_RUNTIME_ROOT:-$HOME/.local/share/metamuseum-lam}"
private="$project/FLAME/lam"
mkdir -p "$private/bin" "$runtime/sources"
if [[ ! -x "$private/bin/micromamba" ]]; then
  curl -fL https://micro.mamba.pm/api/micromamba/linux-64/2.10.0 -o "$private/micromamba.tar.bz2"
  printf '%s  %s\n' 9a97976244929bbae28fb1fae504e74a3e7e6d1932870e3a03321f01b7fbd07b "$private/micromamba.tar.bz2" | sha256sum --check
  tar -xjf "$private/micromamba.tar.bz2" -C "$private" bin/micromamba
fi
if [[ ! -x "$runtime/env/bin/python" ]]; then
  "$private/bin/micromamba" create -y -r "$runtime/mamba-root" -p "$runtime/env" -c conda-forge -c nvidia \
    python=3.10 pip cmake ninja gxx_linux-64=13 cuda-nvcc=12.8 cuda-cudart-dev=12.8 cuda-driver-dev=12.8 cuda-cccl=12.8 xorg-libsm
fi
run() { bash "$project/tools/avatars/lam/run.sh" "$@"; }
run python -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
run python -m pip install -r "$project/tools/avatars/lam/requirements.txt"
clone() {
  local url="$1" dest="$2" revision="$3"
  if [[ ! -d "$dest/.git" ]]; then git clone "$url" "$dest"; fi
  [[ "$(git -C "$dest" rev-parse HEAD)" == "$revision" ]] || git -C "$dest" checkout --detach "$revision"
  git -C "$dest" submodule update --init --recursive
}
clone https://github.com/aigc3d/LAM.git "$private/upstream" 339573649dd93df4cba8093a964e85a80d1b61f3
clone https://github.com/facebookresearch/pytorch3d.git "$runtime/sources/pytorch3d" e4ad6e5687a360ccdc6ebd91348e8dbbac97bf31
clone https://github.com/ashawkey/diff-gaussian-rasterization.git "$runtime/sources/diff-gaussian-rasterization" 8829d14f814fccdaf840b7b0f3021a616583c0a1
clone https://github.com/ShenhanQian/nvdiffrast.git "$runtime/sources/nvdiffrast" 22718580f24a313c429ba2c304794c264351f108
run bash "$project/tools/avatars/lam/build_extensions.sh"
# extractall(filter='data') needs Python 3.12: use the app's existing Windows venv.
"$project/.venv/Scripts/python.exe" "$(wslpath -w "$project/tools/avatars/lam/fetch_assets.py")"
run python -m pip install --no-deps "$private/cache/fbx-2020.3.4-cp310-cp310-manylinux1_x86_64.whl"
for model in flame_assets/flame flame_vhap; do
  run python "$project/tools/avatars/lam/prepare_model.py" "$private/upstream/model_zoo/human_parametric_models/$model/flame2023.pkl"
done
cd "$private/upstream/external/landmark_detection/FaceBoxesV2/utils"
run python build.py build_ext --inplace
run python -c 'import torch; import pytorch3d._C, diff_gaussian_rasterization, nvdiffrast.torch; print(torch.__version__, torch.cuda.get_device_name(0), torch.ones(1, device="cuda").item())'
