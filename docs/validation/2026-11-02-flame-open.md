# FLAME 2023 Open conversion and sample-rights check

Date: 2026-11-02. This replaces the pending model choice in the earlier [desktop/avatar investigation](2026-11-02-desktop-avatar.md). No production settings or assets were changed.

## Result

The default exporter now builds a separate `FLAME/derived/web-open` package from the user-provided `FLAME2023Open.zip`. The original `FLAME/derived/web` remains intact. The package has 5,143 vertices, 10,144 faces, 89,021 bound Gaussians and an 8,786,988-byte rig. The Open model file SHA-256 is `e75a0990728ba038c7da2a420ae4396f7ddd7781366c13026066c5b24f127623`.

The actual template, pose correctives, weights, parents, faces and first 300 identity directions match the user's original model. Its expression directions differ, so retaining the original expression coefficients unchanged would be incorrect. The exporter projects the first-frame coefficients into the Open expression basis using a float64 least-squares solve. This uses the mathematical objective of the [converter linked by the official FLAME website](https://github.com/Suraj-Bhor/flame_to_flame_open_converter/tree/5dd788ed74b7fa705637c17ede71285bbb5534aa), without installing Torch or copying its runtime.

Every exported head expression direction matches the Open model exactly; added-teeth expression directions are zero. Neither the original expression basis nor the conversion matrix is exported. The first-frame expression displacement residual before pose correctives/skinning is **0.375671 mm mean / 3.809667 mm maximum**, over 5,023 vertices. This is not an all-motion or perceptual-quality measurement. New expression sliders operate in the Open basis. Preview status and experiment records identify the model variant, and records include the model SHA-256.

## Conditions found in primary sources

| Component | Evidence | What is established / remaining |
| --- | --- | --- |
| FLAME 2023 Open | [Official model license](https://flame.is.tue.mpg.de/modellicense.html), Open Model License section | The Open model is offered under CC-BY with attribution, license link and modification notices. This does not relicense original FLAME 2023. The package manifest and preview include model attribution and identify adaptations. |
| GaussianAvatars software | [Repository README](https://github.com/ShenhanQian/GaussianAvatars#licenses), [CC-BY-NC-SA-4.0 license](https://github.com/ShenhanQian/GaussianAvatars/blob/29b0021308d45c6dce0b522044a4893e189c7a23/LICENSE.md), [maintainer clarification](https://github.com/ShenhanQian/GaussianAvatars/issues/10#issuecomment-1961436394) | Non-commercial use/modification is permitted under its stated terms; attribution and ShareAlike still apply. Open FLAME does not make this software commercially licensed. |
| Subject 306 pretrained files | [Official demo instructions](https://github.com/ShenhanQian/GaussianAvatars#0-demo), [files in the repository](https://github.com/ShenhanQian/GaussianAvatars/tree/29b0021308d45c6dce0b522044a4893e189c7a23/media/306) | The authors provide the trained model for demo use. No separate subject-specific redistribution/likeness grant was found in the inspected README, directory or license discussion. Repository availability alone does not establish all third-party rights. |
| NeRSemble data | [Official dataset access instructions](https://github.com/tobias-kirschstein/nersemble-data#2-data-access--setup) | Dataset access requires approval. Its linked agreement form redirected to Google sign-in in the available browser, so its full terms were not verified. The downloader's software license must not be treated as a dataset/model redistribution license. |
| Other rights | [Creative Commons' own notice](https://creativecommons.org/licenses/by-nc-sa/4.0/#ref-notice) | The CC license does not necessarily supply publicity/privacy/personality permissions. A PIN cannot supply missing rights or recall model bytes received by an authenticated client. |

The Open model component's license is identified. **The combined subject-306 package is not marked cleared for external distribution.** Its manifest deliberately retains `private-local-only` and `publicDistribution: false`. A subject-specific grant covering the pretrained PLY and baked identity/motion, or an independently captured and authorized subject, is still needed to close that part of the review. No request was submitted or message sent to the authors.

## Focused checks

- Three offline synthetic tests passed: expression-basis conversion, invalid-input rejection, and numeric-only unpickling including the Open model's newer NumPy array representation. Arbitrary globals remain rejected.
- Actual Open rig: all 5,143 vertices in each of nine reference poses match the independent NumPy float64 evaluator after Float32 rounding; observed maximum absolute difference **0 meters**. This checks our two evaluators, not an execution of the original Torch pipeline.
- Existing focused frontend runtime/status tests: six passed. Production TypeScript/Vite build passed.
- Real desktop browser using the production bundle and a loopback-only API: PIN unlock loaded the actual Open package; status showed `FLAME-2023-Open`, 89,021 Gaussians and ongoing gaze updates. Jaw at 12 degrees and Open expression coefficient 0 at +1 rendered. Zero console errors; the existing non-fatal multiple-Three.js warning remains.
- Prior WASD/PIN fix commit `4c72b54` completed [push CI successfully](https://github.com/sebaram/multi_display_artworks/actions/runs/41398566012).

No full-motion matrix, performance matrix, physical mobile/Quest check, training/refitting, production deployment or public model distribution was performed.
