import { beforeAll, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAvatarInstance } from '../../src/avatar/resources';
import { loadAvatarCatalog } from '../../src/avatar/catalog';
import { createAvatarEntity } from '../../src/scene/legacy/avatar-renderer.js';
import { createSceneRenderer } from '../../src/scene/legacy/rendering/scene.js';
import { updateAvatarMotion } from '../../src/avatar/motion';
import * as ik from '../../src/avatar/two-bone-ik';
import { AvatarPoseBuffer, identityPose } from '../../src/avatar/pose';
import { encodeAvatarPose } from '../../src/avatar/pose-codec';
import { bootstrapRoomRealtime } from '../../src/scene/legacy/application.js';
let THREE: any, preset: any;
beforeAll(async () => {
  window.eval(readFileSync('public/vendor/aframe-1.8.0.min.js', 'utf8'));
  THREE = (window as any).AFRAME.THREE;
  // jsdom cannot decode images; keep the real GLTFLoader/skin parser and supply
  // only the decoded 1px image at this browser boundary.
  vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation((_url: unknown, onLoad: any) => {
    const image = document.createElement('img'); image.width = image.height = 1;
    queueMicrotask(() => onLoad(image));
    return image;
  });
  const data = JSON.parse(readFileSync('public/avatars/catalog.fixture.json', 'utf8'));
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
  preset = (await loadAvatarCatalog()).presets.find((p: any) => p.id === 'casual');
  vi.spyOn(THREE.GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const bytes = readFileSync('public/avatars/common-humanoid.glb');
    return new Promise((resolve, reject) => new THREE.GLTFLoader().parse(new window.Uint8Array(bytes).buffer, '', resolve, reject));
  });
});
const appearance = (top: string, hatId = 'none') => ({ ...preset.defaultAppearance, colors: { ...preset.defaultAppearance.colors, top }, hatId });

test('low detail has fewer real triangles, shared resources and latest hidden appearance restoration', async () => {
  const scene = new THREE.Scene(), a = await createAvatarInstance({scene,preset}), b = await createAvatarInstance({scene,preset});
  const full = a.root.getObjectByName('Body'), low = a.root.getObjectByName('BodyLow');
  expect(low?.isSkinnedMesh).toBe(true);
  expect(low.geometry.index.count).toBeLessThan(full.geometry.index.count / 2);
  expect(low.geometry).toBe(b.root.getObjectByName('BodyLow').geometry);
  expect(low.skeleton).toBe(full.skeleton);
  a.setDetail('low');expect(full.visible).toBe(false);expect(low.visible).toBe(true);
  a.setDetail('hidden');a.applyAppearance({...appearance('#123456','cap'),faceId:'calm'});
  a.setDetail('full');expect(full.visible).toBe(true);expect(low.visible).toBe(false);
  expect(a.root.getObjectByName('Cap').visible).toBe(true);
  expect(a.root.getObjectByName('FaceCalm').visible).toBe(true);
  expect(b.root.getObjectByName('Cap').visible).toBe(false);
  const released=vi.fn();low.geometry.addEventListener('dispose',released);
  a.dispose();expect(released).not.toHaveBeenCalled();b.dispose();expect(released).toHaveBeenCalledTimes(1);
});

test('blink and manual response are display-only and return to latest saved face', async () => {
  const a=await createAvatarInstance({scene:new THREE.Scene(),preset});
  a.applyAppearance({...appearance('#123456'),faceId:'friendly'});
  a.updateExpression(4000);expect(a.root.getObjectByName('FaceCalm').visible).toBe(true);
  a.updateExpression(4200);expect(a.root.getObjectByName('FaceFriendly').visible).toBe(true);
  a.showExpression('😐',4200);a.updateExpression(4300);expect(a.root.getObjectByName('FaceCalm').visible).toBe(true);
  a.applyAppearance({...appearance('#123456'),faceId:'calm'});
  a.updateExpression(8000);expect(a.root.getObjectByName('FaceCalm').visible).toBe(true);
  a.dispose();
});

test('hidden owner solves once while additional real skinned observers only apply final rotations and uniform scale', async () => {
  const scene=new THREE.Scene(), owner=await createAvatarInstance({scene,preset});
  const peers=await Promise.all([createAvatarInstance({scene,preset}),createAvatarInstance({scene,preset}),createAvatarInstance({scene,preset})]);
  const solve=vi.spyOn(ik,'solveTwoBone');owner.setDetail('hidden');
  const pose=updateAvatarMotion(owner,{version:2,sampleTime:10,bodyScale:1.2,root:{position:[0,0,0],orientation:[0,0,0,1]},head:{position:[0,1.92,0],orientation:[0,0,0,1]},left:null,right:null,tracking:{head:true,left:false,right:false},locomotion:{velocity:[0,0,0],grounded:true,teleport:false}},.016,{height:0},'hidden');
  expect(solve).toHaveBeenCalledTimes(2);
  for(const peer of peers){peer.applyPose(pose);expect(peer.root.scale.x).toBe(1.2);expect(peer.root.getObjectByName('leftLowerLeg').position.y).toBeCloseTo(-.42);expect(peer.root.getObjectByName('Body').geometry).toBe(owner.root.getObjectByName('Body').geometry);}
  expect(solve).toHaveBeenCalledTimes(2);expect(owner.root.visible).toBe(false);expect(pose.boneRotations.length).toBe(88);
  solve.mockRestore();owner.dispose();peers.forEach(peer=>peer.dispose());
});

test('friendly and calm switch distinct face geometry on one visitor only', async () => {
  const scene = new THREE.Scene();
  const a = await createAvatarInstance({ scene, preset });
  const b = await createAvatarInstance({ scene, preset });
  expect(a.root.getObjectByName('FaceFriendly')).toBeDefined();
  a.applyAppearance({ ...appearance('#FF0000'), faceId: 'calm' });
  expect(a.root.getObjectByName('FaceFriendly').visible).toBe(false);
  expect(a.root.getObjectByName('FaceCalm').visible).toBe(true);
  expect(b.root.getObjectByName('FaceFriendly').visible).toBe(true);
  a.dispose(); b.dispose();
});
test('real skinned humanoid clones isolate joints, palette and head attachments while sharing geometry/textures until last release', async () => {
  const scene = new THREE.Scene();
  const a = await createAvatarInstance({ scene, preset, appearance: appearance('#FF0000', 'cap') });
  const b = await createAvatarInstance({ scene, preset: { ...preset, id: 'sporty' }, appearance: appearance('#0000FF') });
  const ma = a.root.getObjectByName('Body'), mb = b.root.getObjectByName('Body');
  expect(ma.isSkinnedMesh).toBe(true);
  expect(ma.geometry.attributes.skinWeight.count).toBeGreaterThan(100);
  expect(ma.skeleton).not.toBe(mb.skeleton);
  expect(a.mixer).not.toBe(b.mixer);
  expect(a.animations).toBe(b.animations);
  expect(a.animations.map((clip: any) => clip.name)).toEqual(['idle', 'walk']);
  expect(ma.skeleton.bones[0]).not.toBe(mb.skeleton.bones[0]);
  ma.skeleton.bones[0].rotation.y = .8;
  expect(mb.skeleton.bones[0].rotation.y).toBe(0);
  expect(ma.material).not.toBe(mb.material);
  expect(ma.material.userData.avatarColors.top.value.getHexString()).toBe('ff0000');
  expect(mb.material.userData.avatarColors.top.value.getHexString()).toBe('0000ff');
  expect(a.root.getObjectByName('Cap').visible).toBe(true);
  expect(b.root.getObjectByName('Cap').visible).toBe(false);
  expect(a.root.getObjectByName('Cap').parent.name).toBe('HeadAnchor');
  expect(ma.geometry).toBe(mb.geometry);
  expect(ma.material.map).toBe(mb.material.map);
  const geometryDisposed = vi.fn(), textureDisposed = vi.fn(), materialDisposed = vi.fn();
  ma.geometry.addEventListener('dispose', geometryDisposed);
  ma.material.map.addEventListener('dispose', textureDisposed);
  ma.material.addEventListener('dispose', materialDisposed);
  a.dispose(); a.dispose();
  expect(materialDisposed).toHaveBeenCalledTimes(1);
  expect(geometryDisposed).not.toHaveBeenCalled();
  expect(textureDisposed).not.toHaveBeenCalled();
  expect(scene.children).toEqual([b.root]);
  b.dispose();
  expect(geometryDisposed).toHaveBeenCalledTimes(1);
  expect(textureDisposed).toHaveBeenCalledTimes(1);
});
test('abort during shared load never attaches a disposed avatar and releases the last pending resource', async () => {
  const original = THREE.GLTFLoader.prototype.loadAsync.getMockImplementation();
  let finish!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const released = vi.fn();
  THREE.GLTFLoader.prototype.loadAsync.mockImplementation(async function(this: any, url: string) {
    markStarted(); await gate;
    const gltf = await original.call(this, url);
    gltf.scene.getObjectByName('Body').geometry.addEventListener('dispose', released);
    return gltf;
  });
  const scene = new THREE.Scene(), controller = new AbortController();
  const pending = createAvatarInstance({ scene, preset, appearance: appearance('#FF0000'), signal: controller.signal });
  await started;
  controller.abort(); finish();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(scene.children).toHaveLength(0);
  expect(released).toHaveBeenCalledTimes(1);
  THREE.GLTFLoader.prototype.loadAsync.mockImplementation(original);
});

test('aborting one concurrent load consumer preserves the surviving avatar until its final release', async () => {
  const loader = THREE.GLTFLoader.prototype.loadAsync, original = loader.getMockImplementation();
  let finish!: () => void, markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const geometryReleased = vi.fn(), textureReleased = vi.fn();
  loader.mockClear();
  loader.mockImplementation(async function(this: any, url: string) {
    markStarted(); await gate;
    const gltf = await original.call(this, url), body = gltf.scene.getObjectByName('Body');
    body.geometry.addEventListener('dispose', geometryReleased);
    body.material.map.addEventListener('dispose', textureReleased);
    return gltf;
  });
  const scene = new THREE.Scene(), controller = new AbortController();
  const cancelled = createAvatarInstance({ scene, preset, signal: controller.signal });
  const surviving = createAvatarInstance({ scene, preset });
  await started;
  controller.abort(); finish();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  const survivor = await surviving;
  expect(loader).toHaveBeenCalledTimes(1);
  expect(scene.children).toEqual([survivor.root]);
  expect(geometryReleased).not.toHaveBeenCalled();
  expect(textureReleased).not.toHaveBeenCalled();
  survivor.dispose();
  expect(geometryReleased).toHaveBeenCalledTimes(1);
  expect(textureReleased).toHaveBeenCalledTimes(1);
  loader.mockImplementation(original);
});

// Only the DOM surface is supplied; factory, loader, rig and appearance updates
// remain the real implementation used by the room renderer.
class AvatarElement {
  attributes = new Map<string, unknown>();
  children: AvatarElement[] = [];
  parentNode?: AvatarElement;
  object3D = new THREE.Object3D();
  avatarReady?: Promise<any>;
  setAttribute(name: string, value: unknown) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name); }
  appendChild(child: AvatarElement) { this.children.push(child); child.parentNode = this; }
  querySelector(selector: string) { return this.children.find(child => child.getAttribute('class') === selector.slice(1)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
}
test.each(['ready', 'loading'])('avatarId-only preset changes update colors and cap on the same %s humanoid root', async state => {
  const scene = new AvatarElement(), loader = THREE.GLTFLoader.prototype.loadAsync;
  const original = loader.getMockImplementation();
  loader.mockClear();
  let finish!: () => void, markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  if (state === 'loading') loader.mockImplementation(async function(this: any, url: string) { markStarted(); await gate; return original.call(this, url); });
  const find = (element: AvatarElement, id: string): AvatarElement | undefined => element.getAttribute('id') === id ? element : element.children.map(child => find(child, id)).find(Boolean);
  const document = { createElement: () => new AvatarElement(), getElementById: (id: string) => find(scene, id), querySelector: () => scene };
  const renderer = createSceneRenderer({ document, scene, selfId: 'self', createAvatarEntity: (profile: any) => createAvatarEntity(profile, document) });
  renderer.syncRoster([{ userId: 'other', avatarId: 'casual' }]);
  const wrapper = document.getElementById('camera-other')!.querySelector('.remote-avatar')!;
  let initialRoot: any;
  if (state === 'ready') {
    initialRoot = (await wrapper.avatarReady).root;
    expect(initialRoot.getObjectByName('Cap').visible).toBe(false);
  } else await started;
  renderer.syncRoster([{ userId: 'other', avatarId: 'sporty' }]);
  if (state === 'loading') finish();
  const instance = await wrapper.avatarReady, root = instance.root;
  const sameWrapper = document.getElementById('camera-other')!.querySelector('.remote-avatar');
  const actual = { top: root.getObjectByName('Body').material.userData.avatarColors.top.value.getHexString(), cap: root.getObjectByName('Cap').visible, hair: root.getObjectByName('HairShort').visible };
  expect(sameWrapper).toBe(wrapper);
  expect(loader).toHaveBeenCalledTimes(1);
  if (state === 'ready') expect(root).toBe(initialRoot);
  renderer.destroy(); loader.mockImplementation(original);
  expect(actual).toEqual({ top: 'e86b50', cap: true, hair: false });
});

test('a caller asset URL never replaces the catalog URL and failed loads can be retried', async () => {
  const loader = THREE.GLTFLoader.prototype.loadAsync;
  const original = loader.getMockImplementation();
  loader.mockRejectedValueOnce(Error('offline'));
  const scene = new THREE.Scene();
  await expect(createAvatarInstance({ scene, preset, appearance: appearance('#123456') })).rejects.toThrow('offline');
  loader.mockClear(); loader.mockImplementation(original);
  const instance = await createAvatarInstance({ scene, preset: { ...preset, assetUrl: 'https://attacker.invalid/model.glb' }, appearance: appearance('#123456') });
  expect(loader.mock.calls[0][0]).toBe('/avatars/common-humanoid.glb');
  instance.dispose();
});

test('a remote model load failure renders a visible fallback in the visitor wrapper', async () => {
  const loader = THREE.GLTFLoader.prototype.loadAsync;
  loader.mockRejectedValueOnce(Error('offline'));
  const wrapper = createAvatarEntity({ avatarId: 'casual' }, {
    createElement: () => new AvatarElement(),
    querySelector: () => ({ object3D: new THREE.Scene() }),
  });
  await wrapper.avatarReady;
  expect(wrapper.getAttribute('data-avatar-fallback')).toBe('true');
  expect(wrapper.children.length).toBeGreaterThan(0);
  wrapper.disposeAvatar();
});
test('pose uses frozen parent-relative bone order and rest hips offset without re-solving IK', async () => {
  const a = await createAvatarInstance({ scene: new THREE.Scene(), preset, appearance: appearance('#123456') });
  const rotations = new Float32Array(preset.coreBones.length * 4);
  for (let i = 3; i < rotations.length; i += 4) rotations[i] = 1;
  rotations.set([0, Math.sin(.25), 0, Math.cos(.25)], 4 * preset.coreBones.indexOf('head'));
  a.applyPose({ version: 2, rigVersion: 'humanoid-v1', sequence: 1, sampleTime: 0, root: { position: [1,0,2], orientation: [0,0,0,1] }, hipsOffset: [0,.1,0], boneRotations: rotations, tracking: { head: true, left: false, right: false }, teleport: false });
  expect(a.root.position.toArray()).toEqual([1,0,2]);
  expect(a.root.getObjectByName('hips').position.y).toBeCloseTo(1.02);
  expect(a.root.getObjectByName('head').rotation.y).toBeCloseTo(.5);
  a.dispose();
});

test('teleport and a new generation keep the real body and compatibility head together on the receipt frame and during interpolation delay', async () => {
  const scene = new AvatarElement();
  const find = (element: AvatarElement, id: string): AvatarElement | undefined => element.getAttribute('id') === id ? element : element.children.map(child => find(child, id)).find(Boolean);
  const document = { createElement: () => new AvatarElement(), getElementById: (id: string) => find(scene, id), querySelector: () => scene };
  const renderer = createSceneRenderer({ document, scene, selfId:'self', createAvatarEntity:(profile:any)=>createAvatarEntity(profile, document) });
  const handlers: Record<string, (data:any)=>void> = {};
  const socket = { on:(event:string, handler:any)=>{handlers[event]=handler;}, off() {}, connect() {}, disconnect() {}, emit() {} };
  const realtime = bootstrapRoomRealtime({ bootstrapData:{roomId:'room'}, visitorSession:{visitorId:'self',capability:'signed'},
    ioFactory:()=>socket, profileController:{joinPayload:()=>({room_id:'room'}),setSocketClient() {}},socketUrl:'https://museum.test',consumers:{syncRoster:renderer.syncRoster} });
  const poses = new AvatarPoseBuffer();
  let time=1850;
  const clock=vi.spyOn(Date,'now').mockImplementation(()=>time);
  const receive=(x:number,generation:string,teleport:boolean,sequence:number)=>{
    const pose=identityPose();pose.root.position[0]=x;pose.sequence=sequence;pose.teleport=teleport;
    handlers.avatar_pose({userId:'other',generation,serverTime:time,position:{x,y:1.64,z:0},rotation:{x:0,y:0,z:0},pose:encodeAvatarPose(pose)});
    poses.record('other',pose,generation,time,time);
  };
  try {
    const seed=identityPose();
    handlers.room_state({room_id:'room',users:[{userId:'other',avatarId:'casual',position:{x:0,y:1.64,z:0},rotation:{x:0,y:0,z:0},avatarPose:{generation:'first',serverTime:time,pose:encodeAvatarPose(seed)}}]});
    poses.record('other',seed,'first',time,time);
    const camera=document.getElementById('camera-other')!;
    const instance=await camera.querySelector('.remote-avatar')!.avatarReady;
    const frame=(at:number,expectedX:number)=>{
      renderer.applyPoses(new Map([['other',realtime.poseBuffer.poseAt('other',at)]]));
      renderer.applyAvatarPoses(new Map([['other',poses.poseAt('other',at)]]));
      const head=instance.root.getObjectByName('HeadAnchor').getWorldPosition(new THREE.Vector3());
      expect(instance.root.position.x).toBe(expectedX);
      expect(camera.object3D.position.x).toBe(expectedX);
      expect(camera.object3D.position.distanceTo(head)).toBeLessThan(1e-6);
    };
    frame(time,0);
    time=1900;receive(.5,'first',false,1);
    frame(time,0);frame(1975,.25); // The first live packet keeps the authoritative join seed.
    time=2000;receive(10,'first',true,2);
    for(const elapsed of [0,25,75,99,100]) frame(time+elapsed,10);
    time=2100;receive(20,'replacement',false,0);
    for(const elapsed of [0,25,75,99,100]) frame(time+elapsed,20);
  } finally { clock.mockRestore();realtime.destroy();renderer.destroy(); }
});
