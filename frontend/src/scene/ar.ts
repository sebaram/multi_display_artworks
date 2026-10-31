import { io } from "socket.io-client";
import { api } from "../api/client";
import { createLifetime } from "./lifetime";
import { safeMediaUrl } from "./mountRoom";
let arRuntime: Promise<void> | undefined;
export function loadAR() {
  if ((window as any).AFRAME?.systems?.arjs) return Promise.resolve();
  return (arRuntime ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/aframe-ar-3.4.7.js";
    script.onload = () => resolve();
    script.onerror = () => {
      arRuntime = undefined;
      reject(Error("AR 카메라 런타임을 불러오지 못했습니다."));
    };
    document.head.append(script);
  }));
}
export function mountAR({
  scene,
  roomId,
  phone = false,
  marker = false,
  onStatus,
}: {
  scene: any;
  roomId: string;
  phone?: boolean;
  marker?: boolean;
  onStatus?: (message: string) => void;
}) {
  const life = createLifetime();
  const bodyStyle = document.body.getAttribute("style");
  let socket: ReturnType<typeof io> | undefined;
  let active: HTMLElement | undefined;
  let markers: any[] = [];
  let lastTarget: any;
  if (!marker) {
    socket = io({ transports: ["websocket", "polling"] });
    life.add(() => {
      socket?.removeAllListeners();
      socket?.disconnect();
    });
    socket.on("connect", () => {
      socket?.emit("join_ar_room", {
        room_id: roomId,
        device: phone ? "phone" : "vision_pro",
      });
      onStatus?.("AR 기기 연결됨");
    });
    socket.on("disconnect", () => onStatus?.("AR 연결 끊김 · 재연결 중"));
    if (phone)
      socket.on("joined", () => {
        socket?.emit("set_marker_config", { room_id: roomId, markers });
      });
    if (!phone) {
      void api<any[]>(`/marker/room/${roomId}/markers`)
        .then((configs) => {
          if (life.disposed) return;
          markers = configs;
          socket?.emit("request_sync", { room_id: roomId });
        })
        .catch(() => {});
      const apply = (data: any) => {
        if (!data.found) {
          onStatus?.("폰에서 마커를 찾고 있습니다.");
          return;
        }
        const config = markers.find((marker) => marker.id === data.marker_id);
        if (data.target_position) lastTarget = data;
        else if (config)
          lastTarget = {
            target_position: config.target_position,
            target_rotation: config.target_rotation,
            marker_name: config.name,
          };
        if (!lastTarget) return;
        const camera = scene.querySelector("#camera");
        camera?.setAttribute("position", lastTarget.target_position);
        camera?.setAttribute("rotation", lastTarget.target_rotation || "0 0 0");
        onStatus?.(`${lastTarget.marker_name || "마커"} 위치로 이동했습니다.`);
      };
      socket.on("pose_update", apply);
      socket.on("sync_state", (data: any) => {
        if (data.latest_pose) apply(data.latest_pose);
      });
    }
  }
  if (phone || marker) {
    scene.setAttribute(
      "arjs",
      "sourceType: webcam; debugUIEnabled: false; cameraParametersUrl: /vendor/arjs/camera_para.dat",
    );
    scene.setAttribute("background", "transparent: true");
    scene
      .querySelector("#camera")
      ?.setAttribute("look-controls", "enabled: false");
    scene
      .querySelector("#camera")
      ?.setAttribute("wasd-controls", "enabled: false");
    void api<any[]>(`/marker/room/${roomId}/markers`)
      .then((configs) => {
        if (life.disposed) return;
        markers = configs;
        if (phone && socket?.connected)
          socket.emit("set_marker_config", { room_id: roomId, markers });
        for (const config of configs) {
          const anchor = document.createElement(
            config.marker_type === "image" ? "a-nft" : "a-marker",
          );
          anchor.id = `ar-marker-${config.id}`;
          if (config.marker_type === "hiro")
            anchor.setAttribute("preset", "hiro");
          else {
            anchor.setAttribute(
              "type",
              config.marker_type === "pattern" ? "pattern" : "nft",
            );
            anchor.setAttribute("url", safeMediaUrl(config.marker_value));
          }
          const found = () => {
            active = anchor;
            onStatus?.(`${config.name} 감지됨`);
            if (marker) {
              scene
                .querySelector("#camera")
                ?.setAttribute("position", config.target_position);
              scene
                .querySelector("#camera")
                ?.setAttribute("rotation", config.target_rotation);
            }
            send("found", anchor);
          };
          const lost = () => {
            if (active === anchor) active = undefined;
            onStatus?.("마커를 비춰 주세요.");
            socket?.emit("marker_update", {
              room_id: roomId,
              marker_id: config.id,
              update_type: "lost",
            });
          };
          anchor.addEventListener("markerFound", found);
          anchor.addEventListener("markerLost", lost);
          scene.append(anchor);
          life.add(() => {
            anchor.removeEventListener("markerFound", found);
            anchor.removeEventListener("markerLost", lost);
            anchor.remove();
          });
        }
        onStatus?.(
          configs.length
            ? `${configs.length}개 마커 준비됨 · 카메라에 마커를 비춰 주세요.`
            : "이 방에 등록된 마커가 없습니다. 스튜디오에서 마커를 등록하세요.",
        );
      })
      .catch((error) => {
        if (!life.disposed) onStatus?.(error.message);
      });
    const timer = window.setInterval(() => {
      if (active) send("pose", active);
    }, 100);
    life.add(() => clearInterval(timer));
    const error = (event: any) =>
      onStatus?.(
        `카메라를 시작하지 못했습니다. ${event.detail?.error?.message || "카메라 권한을 확인하세요."}`,
      );
    scene.addEventListener("camera-error", error);
    life.add(() => scene.removeEventListener("camera-error", error));
  }
  function send(updateType: string, anchor: any) {
    const p = anchor.object3D?.position,
      r = anchor.object3D?.rotation;
    if (!p || !r) return;
    socket?.emit("marker_update", {
      room_id: roomId,
      marker_id: anchor.id.replace("ar-marker-", ""),
      update_type: updateType,
      pose: {
        x: p.x,
        y: p.y,
        z: p.z,
        rx: (r.x * 180) / Math.PI,
        ry: (r.y * 180) / Math.PI,
        rz: (r.z * 180) / Math.PI,
      },
    });
  }
  life.add(() => {
    const system = scene.systems?.arjs;
    const arSession = system?._arSession;
    const source = arSession?.arSource;
    const video = source?.domElement;
    if (video?.srcObject)
      video.srcObject
        .getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
    video?.remove();
    if (system?.remove) system.remove();
    else arSession?.arContext?.arController?.dispose?.();
    if (bodyStyle === null) document.body.removeAttribute("style");
    else document.body.setAttribute("style", bodyStyle);
    document.getElementById("arjsDebugUIContainer")?.remove();
  });
  return { dispose: life.dispose };
}
