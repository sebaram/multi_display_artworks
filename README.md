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
- [ ] Add some additional marker add-on for each images(like QR or synchro): assume physical user extra contents on their devices
- [ ] Add Cutout option for GaussianSplat=> make clear
- [ ] text(relationship) based auto images placement(LLM powered)
- [ ] Drag to move images/wall/gaussiansplat
  - https://github.com/jesstelford/aframe-click-drag-component
- [ ] Video background contents on wall
- [ ] Add auto-refresh on wall page(toggle by parameter?)
- [ ] AR walking(now we are using joystick)
- [ ] Save user position/rotation tracking information
- [ ] Automatic screen size fitting
- [ ] MongoDB to use abstract class to fetch wall elements


### Not-web
- [ ] Tracking people in real world and update to server
  - using correlation between user's movement in AR mode and tracked position by surveillance camera?


## Acknowledgment
This work was supported by Institute of Information & communications Technology Planning & Evaluation (IITP) grant funded by the Korea government(MSIT) (No.2019-0-01270, WISE AR UI/UX Platform Development for Smartglasses)

