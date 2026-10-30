import { expect, test } from 'vitest';
import { avatarSocketParser } from '../../src/avatar/socket-parser';
import { identityPose } from '../../src/avatar/pose';
import { encodeAvatarPose } from '../../src/avatar/pose-codec';
const snapshot=(count:number)=>new avatarSocketParser.Encoder().encode({type:2,nsp:'/',data:['room_state',{users:Array.from({length:count},(_,i)=>({userId:`peer-${i}`,avatarPose:{generation:'g',serverTime:1,pose:encodeAvatarPose(identityPose())}}))}]});
test.each([20,50])('decodes %i actual binary full snapshots on the production parser',count=>{
  const decoder=new avatarSocketParser.Decoder();let decoded:any;
  decoder.on('decoded',packet=>{decoded=packet;});
  for(const part of snapshot(count))decoder.add(part);
  expect(decoded.data[1].users).toHaveLength(count);
  expect(decoded.data[1].users[count-1].avatarPose.pose.floats.byteLength).toBe(392);
  decoder.destroy();
});
test('rejects messages declaring more than64attachments before allocating reconstruction state',()=>{
  const decoder=new avatarSocketParser.Decoder();
  expect(()=>decoder.add(snapshot(65)[0])).toThrow(/attachments/i);
  expect(()=>decoder.add('599999999999999-["room_state",{}]')).toThrow();
  decoder.destroy();
});
