import type { AvatarPoseV2 } from "./types";
import { decodeAvatarPose, encodeAvatarPose } from "./pose-codec";
export type PoseDelivery = {
  userId: string;
  generation: string;
  serverTime: number;
  pose: AvatarPoseV2;
};
export interface AvatarPoseTransport {
  publish(pose: AvatarPoseV2): void;
  subscribe(listener: (delivery: PoseDelivery) => void): () => void;
  dispose(): void;
}
export function createAvatarPoseTransport(
  client: any,
  roomId: string,
): AvatarPoseTransport {
  let generation: string | null = null,
    last: AvatarPoseV2 | undefined,
    sequence = 0,
    disposed = false,
    pendingTeleport = false;
  const listeners = new Set<(delivery: PoseDelivery) => void>();
  const publish = (pose: AvatarPoseV2) => {
    if (disposed) return;
    pendingTeleport ||= pose.teleport;
    last = { ...pose, teleport: pendingTeleport };
    if (
      generation &&
      (client.emitVolatile ?? client.emit).call(client, "avatar_pose", {
        room_id: roomId,
        generation,
        pose: encodeAvatarPose({ ...last, sequence: sequence++ }),
      }) !== false
    )
      pendingTeleport = false;
  };
  const receive = (data: any) => {
    try {
      if (
        typeof data?.userId !== "string" ||
        typeof data.generation !== "string" ||
        !Number.isFinite(data.serverTime)
      )
        return;
      const delivery = { ...data, pose: decodeAvatarPose(data.pose) };
      listeners.forEach((f) => f(delivery));
    } catch {
      /* Invalid snapshots never reach renderers. */
    }
  };
  const off = [
    client.on("disconnect", () => {
      generation = null;
    }),
    client.on("avatar_pose", receive),
    client.on("room_state", (data: any) => {
      if (data?.room_id !== roomId) return;
      (data.users ?? []).forEach((user: any) => {
        if (user.avatarPose)
          receive({
            ...user.avatarPose,
            userId: user.userId,
            serverTime: data.serverTime ?? user.avatarPose.serverTime,
          });
      });
      if (
        typeof data.generation === "string" &&
        generation !== data.generation
      ) {
        generation = data.generation;
        sequence = 0;
        if (last) publish({ ...last, teleport: true });
      }
    }),
  ];
  return {
    publish,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      off.forEach((f) => f());
      listeners.clear();
    },
  };
}
