import { expect, test, vi } from 'vitest';
import { createRemoteAvatarDisplay } from '../../src/avatar/display';
import { AvatarPoseBuffer, identityPose } from '../../src/avatar/pose';
test('remote joints stop offscreen; root stays render cadence; reentry gets latest pose and each replacement resets detail', () => {
  const buffer=new AvatarPoseBuffer(), pose=identityPose();
  const wrapper=()=>({applyAvatarRoot:vi.fn(),applyAvatarPose:vi.fn(),setAvatarDetail:vi.fn(),updateAvatarExpression:vi.fn()});
  let target=wrapper(), visible=true;
  const scene={galleryPerformance:{level:0}}, measure={update(){},measure(){return {visible,distance:3};}};
  const display=createRemoteAvatarDisplay({scene,buffer,targets:()=>new Map([['peer',target]]),visibility:measure,THREE:{Box3:class {min={set(){}};max={set(){}};}}});
  buffer.record('peer',pose,'g',0,0);display.frame(100);
  display.frame(110);expect(target.applyAvatarRoot).toHaveBeenCalledTimes(2);expect(target.applyAvatarPose).toHaveBeenCalledTimes(1);
  visible=false;const latest=identityPose();latest.sequence=1;latest.root.position[0]=7;
  buffer.record('peer',latest,'g',150,150);display.frame(300);
  expect(target.applyAvatarPose).toHaveBeenCalledTimes(1);expect(target.setAvatarDetail).toHaveBeenLastCalledWith('hidden');
  visible=true;display.frame(301);expect(target.applyAvatarPose).toHaveBeenLastCalledWith(latest);
  target=wrapper();display.frame(302);expect(target.applyAvatarPose).toHaveBeenCalledTimes(1);
  display.dispose();expect(display.stats.hidden).toBe(0);
});
