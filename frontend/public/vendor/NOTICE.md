# Room runtime notices

- A-Frame 1.6.0: MIT, `AFRAME-LICENSE`; unmodified pinned release runtime.
- quadjr/aframe-gaussian-splatting 0.0.22 at `b50238f8051cdccf753fa34cbee69ee62a1cbfc2`: MIT, `gaussian-splatting-LICENSE`. Local lifecycle and scene ownership patches are documented in `provenance.json`.
- AR.js 3.4.7: MIT, `arjs-LICENSE`. The local runtime owns and releases session listeners, polling, camera tracks and controllers, guards regular scenes from opening the camera, and uses bundled pinned calibration/Hiro data. See `provenance.json`.
- face-api.js 0.22.2: MIT, `face-api/LICENSE`. Tiny face detector and expression model weights are pinned at `a86f011d72124e5fb93e59d5c4ab98f699dd5c9c`; they load only after the user starts expression detection.
- Existing avatar assets remain served at `/static/gltf/`: Shiba by zixisun02 and Rigged Simple by Cesium, CC BY 4.0. Their original license/attribution files remain beside the assets.

React, React Router, Socket.IO client, Hls.js and qrcode-generator are installed from the locked npm dependencies. Their package license files remain in the npm distributions.
