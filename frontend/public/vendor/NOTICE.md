# Room runtime notices

- A-Frame 1.8.0: MIT, `AFRAME-LICENSE`; unmodified pinned release runtime, including super-three r184. The 1.6.0 file remains available for baseline comparisons.
- Spark 2.4.0: MIT, `spark-LICENSE`. The locally pinned module contains its WASM and worker source. External Three imports use `aframe-three-bridge.js`, binding directly to A-Frame's existing runtime. A small local export releases idle decoder workers when scenes finish using splats. Hashes and exact modifications are in `provenance.json`.
- super-three 0.184.0 `examples/jsm/postprocessing/Pass.js`: MIT, `three-LICENSE`; only its import path changes to the shared Three bridge. This helper does not bundle another Three runtime.
- `gaussian-splatting.js` is the local A-Frame adapter for Spark. The former quadjr/aframe-gaussian-splatting 0.0.22 license remains at `gaussian-splatting-LICENSE` for the historical runtime.
- AR.js 3.4.7: MIT, `arjs-LICENSE`. The local runtime owns and releases session listeners, polling, camera tracks and controllers, guards regular scenes from opening the camera, and uses bundled pinned calibration/Hiro data. See `provenance.json`.
- face-api.js 0.22.2: MIT, `face-api/LICENSE`. Tiny face detector and expression model weights are pinned at `a86f011d72124e5fb93e59d5c4ab98f699dd5c9c`; they load only after the user starts expression detection.
- Existing avatar assets remain served at `/static/gltf/`: Shiba by zixisun02 and Rigged Simple by Cesium, CC BY 4.0. Their original license/attribution files remain beside the assets.

React, React Router, Socket.IO client, Hls.js and qrcode-generator are installed from the locked npm dependencies. Their package license files remain in the npm distributions.
