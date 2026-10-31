import type { AvatarPoseV2, Quat, Vec3 } from "./types";
import { validateGazePose } from './gaze-pose';
export type PosePacket = Omit<
  AvatarPoseV2,
  "root" | "hipsOffset" | "boneRotations"
> & { floats: ArrayBuffer };
export function decodeAvatarPose(packet: any): AvatarPoseV2 {
  const source = packet?.floats;
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : null;
  if (
    packet?.version !== 2 ||
    packet.rigVersion !== "humanoid-v1" ||
    !bytes ||
    bytes.byteLength !== 392 ||
    !Number.isSafeInteger(packet.sequence) ||
    packet.sequence < 0 ||
    !Number.isFinite(packet.sampleTime) ||
    packet.sampleTime < 0 ||
    !Number.isFinite(packet.bodyScale ?? 1) ||
    (packet.bodyScale ?? 1) < 0.5 ||
    (packet.bodyScale ?? 1) > 2 ||
    typeof packet.teleport !== "boolean" ||
    !["head", "left", "right"].every(
      (k) => typeof packet.tracking?.[k] === "boolean",
    )
  )
    throw Error("Invalid avatar pose metadata");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    values = Array.from({ length: 98 }, (_, i) => view.getFloat32(i * 4, true));
  if (
    !values.every(Number.isFinite) ||
    values.slice(0, 3).some((v) => Math.abs(v) > 1e5) ||
    values.slice(7, 10).some((v) => Math.abs(v) > 2)
  )
    throw Error("Invalid avatar coordinates");
  for (const i of [3, ...Array.from({ length: 22 }, (_, n) => 10 + n * 4)])
    if (Math.abs(Math.hypot(...values.slice(i, i + 4)) - 1) > 0.01)
      throw Error("Invalid avatar quaternion");
  return {
    version: 2,
    rigVersion: packet.rigVersion,
    sequence: packet.sequence,
    sampleTime: packet.sampleTime,
    bodyScale: packet.bodyScale ?? 1,
    root: {
      position: values.slice(0, 3) as Vec3,
      orientation: values.slice(3, 7) as Quat,
    },
    hipsOffset: values.slice(7, 10) as Vec3,
    boneRotations: new Float32Array(values.slice(10)),
    tracking: { ...packet.tracking },
    teleport: packet.teleport,
    ...(packet.gaze !== undefined ? { gaze: validateGazePose(packet.gaze) } : {}),
  };
}
export function encodeAvatarPose(pose: AvatarPoseV2): PosePacket {
  const floats = new ArrayBuffer(392),
    view = new DataView(floats);
  const values = [
    ...pose.root.position,
    ...pose.root.orientation,
    ...pose.hipsOffset,
    ...pose.boneRotations,
  ];
  if (values.length !== 98) throw Error("Invalid avatar joint count");
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const packet = {
    version: 2 as const,
    rigVersion: pose.rigVersion,
    sequence: pose.sequence,
    sampleTime: pose.sampleTime,
    bodyScale: pose.bodyScale ?? 1,
    tracking: pose.tracking,
    teleport: pose.teleport,
    ...(pose.gaze !== undefined ? { gaze: validateGazePose(pose.gaze) } : {}),
    floats,
  };
  decodeAvatarPose(packet);
  return packet;
}
