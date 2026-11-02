# LAM photo-input evaluation

The [shared report](https://lam-photo-study.kaist-arrc.chatgpt.site/) requires a
password distributed separately. It contains the three original reference photos,
side-by-side renders, six motion videos, measurements and browser fix evidence.
Neither the password nor personal media is stored in this public repository.

This evaluated **one LAM-20K checkpoint with six input conditions**, not six
different trained models. Each generation used a fresh fit and a new Python
process, seed 42, the existing Q/K normalization adapter, and the same 20,018-point
representation on an RTX PRO 5000 Blackwell / WSL / Torch 2.7.1+cu128 setup.

| Input condition | Pipeline seconds | Peak allocated Torch VRAM GiB | Sampled generator-process RAM GiB |
| --- | ---: | ---: | ---: |
| Portrait A, original | 81.453 | 3.902 | 7.037 |
| Portrait B, original | 77.974 | 3.902 | 7.042 |
| Portrait C, original | 78.370 | 3.902 | 7.045 |
| A, 2x Lanczos + mild sharpening | 79.504 | 3.902 | 7.033 |
| B, tone-preserving autocontrast | 78.843 | 3.902 | 7.038 |
| C, white side margins removed | 78.251 | 3.902 | 7.039 |

Times include preprocessing, fitting, model loading/inference, Blender and ZIP
export, but exclude Python startup/imports before the pipeline timer and initial
environment installation. RAM excludes child processes such as Blender; VRAM
excludes driver/browser allocations. Each condition ran once in sequence, so
small differences do not establish a speed advantage.

Observations: preprocessing gave no clear consistent improvement. Eyeglass frames
were largely omitted, iris appearance changed, and large side views exposed hair,
ear and neck artifacts. Portrait A's original was the preferred starting point
within this small study; this is a qualitative judgment, not identity verification
or a general ranking. Six 8-second videos and 48 still views were validated.

The actual browser check exposed expression accumulation: the alpha SDK modifies
the callback's object in place, including a jaw multiplier of 1.2. Returning a
fresh snapshot each frame prevents calibration compounding and splat divergence.
A regression reproduced 0.55 becoming 0.66, then passed after the fix. Seven
focused frontend tests and the production build passed; a browser hold check
confirmed stable expression output. No full regression or physical-device matrix
was repeated.

The shared site protects every report/media/original request server-side, uses
signed expiring HttpOnly cookies, and stores credentials in runtime secrets.
Original downloads retain their source bytes. Gaussian/FLAME model files remain
local and are not included in the shared site. The original full-resolution local
report remains available in the ignored study folder; shared render stills use
WebP quality 96 to reduce the package size.

Public-sharing checks: every media/original/JSON route rejects anonymous access;
HMAC-cookie tampering, wrong passwords, cross-origin login, request-rate limits,
logout and video byte ranges were checked. Browser form navigation requires a
`same-origin` referrer policy so its Origin header is retained for validation.
