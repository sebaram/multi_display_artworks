"""Offline, single-job LAM inference. Never imported by the web server.

Input photos, fitting intermediates and original model files stay private.
Only avatar.zip and its small provenance manifest belong in the preview root.
"""
import argparse
import gc
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace
import zipfile

REVISION = '339573649dd93df4cba8093a964e85a80d1b61f3'
ROOT = Path(__file__).resolve().parents[3]


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024**2), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.json.part')
    with temporary.open('w') as target:
        json.dump(value, target, indent=2)
        target.write('\n')
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def load_checkpoint(model, state):
    result = model.load_state_dict(state, strict=False)
    # This new upstream buffer is deterministically subdivided from the FLAME
    # regressor at construction. Every learned weight, including DINO, is required.
    allowed = {'renderer.flame_model.J_regressor_up'}
    if set(result.missing_keys) - allowed or result.unexpected_keys:
        raise RuntimeError(f'Checkpoint mismatch: {result}')


def export_browser(upstream, package, mesh):
    from tools.generateARKITGLBWithBlender import update_flame_shape, convert_ascii_to_binary
    blender = upstream / 'thirdparties/blender/blender'
    ascii_fbx, binary_fbx = package / 'head-ascii.fbx', package / 'head.fbx'
    update_flame_shape(Path(mesh), ascii_fbx, upstream / 'assets/sample_oac/template_file.fbx')
    convert_ascii_to_binary(ascii_fbx, binary_fbx)
    for script, source, target in [
        (ROOT / 'tools/avatars/lam/blender_export.py', binary_fbx, package / 'skin.glb'),
        (upstream / 'tools/generateVertexIndices.py', Path(mesh), package / 'vertex_order.json'),
    ]:
        # Blender otherwise returns success even when the Python script raises.
        subprocess.run([str(blender), '--background', '--python-exit-code', '1',
            '--python', str(script), '--', str(source), str(target)], check=True)
        if not target.is_file():
            raise RuntimeError(f'Blender did not create {target.name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--reuse-fit', action='store_true', help='Reuse a completed fit only for this exact image hash')
    args = parser.parse_args()
    image_path, output = args.image.resolve(), args.output.resolve()
    private_root = (ROOT / 'FLAME/lam').resolve()
    if not output.is_relative_to(private_root) or output == private_root:
        parser.error('--output must be a subdirectory of ignored FLAME/lam')
    if not image_path.is_file():
        parser.error('Input image does not exist')
    upstream = private_root / 'upstream'
    revision = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise RuntimeError(f'Expected pinned LAM source {REVISION}, got {revision}')
    # Upstream FBX exporter uses fixed temporary names, so serialize local jobs.
    import fcntl
    job_lock = (private_root / '.generation.lock').open('w')
    fcntl.flock(job_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # Older, integrity-pinned upstream detector checkpoints contain Python classes.
    # This switch is limited to this offline process; no user checkpoints are accepted.
    os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] = '1'
    os.environ['TORCH_COMPILE_DISABLE'] = '1'
    os.chdir(upstream)
    sys.path.insert(0, str(upstream))
    import numpy as np
    # Pinned FaceBoxes Cython NMS still uses the removed NumPy scalar alias.
    np.int = int
    import torch
    from accelerate import Accelerator
    Accelerator()
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'preview/manifest.json').exists():
        raise FileExistsError('Completed output already exists; choose a new output directory')
    started = time.monotonic()
    torch.cuda.reset_peak_memory_stats()
    torch.manual_seed(42)
    image_hash = sha256(image_path)
    fit_record = output / 'fit.json'
    reused_fit = args.reuse_fit and fit_record.is_file()
    if reused_fit:
        fit = json.loads(fit_record.read_text())
        if fit['imageSha256'] != image_hash or fit['sourceRevision'] != REVISION:
            raise ValueError('Cached fit belongs to a different image or LAM revision')
        export_dir = Path(fit['exportDir'])
    else:
        from tools.flame_tracking_single_image import FlameTrackingSingleImage
        tracker = FlameTrackingSingleImage(str(output / 'tracking'), args=SimpleNamespace())
        for name, call in [('preprocess', lambda: tracker.preprocess(str(image_path))), ('fit', tracker.optimize)]:
            if call() != 0:
                raise RuntimeError(f'LAM {name} failed')
        code, export_path = tracker.export()
        if code != 0:
            raise RuntimeError('LAM fit export failed')
        export_dir = Path(export_path)
        write_json(fit_record, {'imageSha256': image_hash, 'sourceRevision': REVISION,
                               'exportDir': str(export_dir)})
        del tracker
        gc.collect()
        torch.cuda.empty_cache()
    fitting_seconds = time.monotonic() - started
    print('Fit ready; loading LAM checkpoint', flush=True)

    from omegaconf import OmegaConf
    from safetensors.torch import load_file
    from lam.models.encoders.dinov2_fusion_wrapper import Dinov2FusionWrapper
    from lam.models import ModelLAM
    from lam.models.transformer_dit import QKNormJointAttnProcessor2_0
    # Import this standalone helper without lam.runners' unused mesh/video stack.
    spec = importlib.util.spec_from_file_location('lam_head_utils', upstream / 'lam/runners/infer/head_utils.py')
    head_utils = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(head_utils)
    preprocess_image = head_utils.preprocess_image
    from einops import rearrange
    # The full LAM checkpoint includes DINO weights. Skip redundant network fetch,
    # and reject ANY missing parameter rather than silently leaving random weights.
    build_encoder = Dinov2FusionWrapper._build_dinov2
    Dinov2FusionWrapper._build_dinov2 = staticmethod(lambda name, modulation_dim=None, pretrained=True:
        build_encoder(name, modulation_dim=modulation_dim, pretrained=False))
    try:
        model = ModelLAM(**OmegaConf.load('configs/inference/lam-20k-8gpu.yaml').model)
    finally:
        Dinov2FusionWrapper._build_dinov2 = staticmethod(build_encoder)
    weights = Path('model_zoo/lam_models/releases/lam/lam-20k/step_045500/model.safetensors')
    state = load_file(str(weights), device='cpu')
    load_checkpoint(model, state)
    del state
    # diffusers 0.30.3's stock joint processor ignores its registered Q/K norms.
    # Use LAM's own shared-normalization processor with these checkpoint weights.
    for layer in model.transformer.layers:
        layer.attn.set_processor(QKNormJointAttnProcessor2_0())
    model = model.eval().to('cuda')
    image, _, _, shape = preprocess_image(str(export_dir / 'images/00000_00.png'),
        mask_path=str(export_dir / 'fg_masks/00000_00.png'), intr=None, pad_ratio=0, bg_color=1.,
        max_tgt_size=None, aspect_standard=1., enlarge_ratio=[1., 1.], render_tgt_size=512,
        multiply=14, need_mask=True, get_shape_param=True)
    flame_data = {'betas': shape.unsqueeze(0).cuda()}
    package = output / 'package'
    package.mkdir(exist_ok=True)
    with torch.no_grad():
        image = image.cuda()
        query, flame_data = model.renderer.get_query_points(flame_data, image.device)
        latent, features = model.forward_latent_points(image, camera=None, query_points=query)
        extra = {'image_feats': features, 'image': image,
                 'image_feats_bchw': rearrange(features, 'b (h w) c -> b c h w', h=int(math.sqrt(features.shape[1])))}
        gaussians, _, _, _ = model.renderer.forward_gs(latent, query, flame_data, additional_features=extra)
        gaussians[0].save_ply(str(package / 'offset.ply'), rgb2sh=False, offset2xyz=True)
        mesh = model.renderer.flame_model.save_shaped_mesh(flame_data['betas'], fd=str(package))
    torch.cuda.synchronize()
    inference_seconds = time.monotonic() - started - fitting_seconds
    print('Gaussian inference complete; exporting browser package', flush=True)
    peak_vram = torch.cuda.max_memory_allocated()
    export_browser(upstream, package, mesh)
    shutil.copyfile('assets/sample_oac/animation.glb', package / 'animation.glb')
    preview = output / 'preview'
    preview.mkdir(exist_ok=True)
    archive_path = preview / 'avatar.zip.part'
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('avatar/', '')
        for name in ['offset.ply', 'skin.glb', 'vertex_order.json', 'animation.glb']:
            archive.write(package / name, 'avatar/' + name)
    archive_path = archive_path.replace(preview / 'avatar.zip')
    manifest = {'format': 'lam-arkit-v1', 'sourceRevision': REVISION,
        'packageSha256': sha256(archive_path), 'gaussians': int(gaussians[0].xyz.shape[0]),
        'fitSeconds': fitting_seconds, 'inferenceSeconds': inference_seconds,
        'totalSeconds': time.monotonic() - started, 'peakAllocatedVramBytes': peak_vram,
        'reusedFit': bool(reused_fit), 'device': torch.cuda.get_device_name(0),
        'torch': torch.__version__, 'cuda': torch.version.cuda,
        'licenseNote': 'LAM weights CC-BY-NC-4.0; FLAME, subject and export assets have separate terms. Local research preview only.'}
    write_json(preview / 'manifest.json', manifest)
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == '__main__':
    main()
