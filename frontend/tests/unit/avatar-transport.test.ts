import { expect, test } from "vitest";
import { createAvatarPoseTransport } from "../../src/avatar/transport";
import { identityPose } from "../../src/avatar/pose";
import { encodeAvatarPose } from "../../src/avatar/pose-codec";
test("uses existing connection, waits for join and republishes stationary snapshot on reconnect; dispose removes listeners", () => {
  const handlers = new Map<string, Set<any>>(),
    sent: any[] = [];
  const client = {
    on(e: string, f: any) {
      if (!handlers.has(e)) handlers.set(e, new Set());
      handlers.get(e)!.add(f);
      return () => handlers.get(e)!.delete(f);
    },
    emit(e: string, p: any) {
      sent.push([e, p]);
      return true;
    },
  };
  const receive = (e: string, p: any) => handlers.get(e)?.forEach((f) => f(p));
  const transport = createAvatarPoseTransport(client, "room");
  let got = 0;
  transport.subscribe(() => got++);
  transport.publish(identityPose());
  expect(sent).toHaveLength(0);
  receive("room_state", { room_id: "room", generation: "g1", users: [] });
  expect(sent).toHaveLength(1);
  expect(sent[0][1].generation).toBe("g1");
  receive("avatar_pose", {
    userId: "u",
    generation: "g1",
    serverTime: 100,
    pose: encodeAvatarPose(identityPose()),
  });
  expect(got).toBe(1);
  let sampleTime = 0;
  transport.subscribe((delivery) => {
    sampleTime = delivery.serverTime;
  });
  receive("room_state", {
    room_id: "room",
    generation: "g1",
    serverTime: 500,
    users: [
      {
        userId: "u",
        avatarPose: {
          generation: "g1",
          serverTime: 100,
          pose: encodeAvatarPose(identityPose()),
        },
      },
    ],
  });
  expect(sampleTime).toBe(500);
  receive("disconnect", {});
  transport.publish(identityPose());
  expect(sent).toHaveLength(1);
  receive("room_state", { room_id: "room", generation: "g2", users: [] });
  expect(sent).toHaveLength(2);
  expect(sent[1][1].pose.sequence).toBe(0);
  transport.dispose();
  expect([...handlers.values()].every((s) => s.size === 0)).toBe(true);
});
