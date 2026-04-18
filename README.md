# multi_display_artworks
Demo: (https://meta.juyounglee.net)

## Introduction
This repository includes modulized 3D space elements structure and viewer. The purpose is to simulate physical space in virtual space and use web addresses to show the designed wall on an interactive display in the real world. Every element is reachable with each address. The web client is based on Aframe. Additional interaction modules will be included in the near future. Please refer to the TODO list to contribute.

### Requirements
- Serverside: python(Flask) ''flask_server/requirements.txt''
- DB: MongoDB

### Library used
 - https://github.com/quadjr/aframe-gaussian-splatting


## TODO

### Web
- [x] Add some additional marker add-on for each images (QR or synchro) — via webpage element
- [x] Add Cutout option for GaussianSplat — UI in element page (admin)
- [ ] text(relationship) based auto images placement (LLM powered)
- [x] Drag to move images/wall/gaussiansplat — drag-component.js, admin-only via auth
- [x] Video background contents on wall — set video_url on Wall model
- [x] Add auto-refresh on wall page (toggle by parameter) — JS refresh with ETag check
- [x] AR walking (now we are using joystick) — AR passthrough button (admin)
- [x] Save user position/rotation tracking information — via /camera-data endpoint
- [x] Automatic screen size fitting — responsive A-Frame scene
- [x] MongoDB to use abstract class to fetch wall elements — WallElement abstract base
- [x] Scale/rotate transform controls for all elements — 6-field transform panel
- [x] Webpage wall element type — iframe embedding with aframe-html-component

### Not-web
- [ ] Tracking people in real world and update to server
  - using correlation between user's movement in AR mode and tracked position by surveillance camera?
- [ ] QR/marker syncing — physical device detection and content overlay

### Ideas / Backlog
- aframe-click-drag-component for wall-level dragging (resize walls)
- LLM-powered image placement based on text descriptions
- Multi-user real-time collaboration (shared element transforms)
- Screenshot/share room state


## Acknowledgment
This work was supported by Institute of Information & communications Technology Planning & Evaluation (IITP) grant funded by the Korea government(MSIT) (No.2019-0-01270, WISE AR UI/UX Platform Development for Smartglasses)

