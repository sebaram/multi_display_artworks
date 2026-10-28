import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadAFrame } from "../../scene/mountRoom";
import { loadAR, mountAR } from "../../scene/ar";
export default function ARCompanion() {
  const [params] = useSearchParams();
  const roomId = params.get("room_id") || "";
  const [status, setStatus] = useState(
      "카메라 시작을 누르면 권한을 요청합니다.",
    ),
    [started, setStarted] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!started || !host.current) return;
    let cancelled = false;
    let ar: ReturnType<typeof mountAR> | undefined;
    let scene: any;
    void loadAFrame()
      .then(loadAR)
      .then(() => {
        if (cancelled || !host.current) return;
        scene = document.createElement("a-scene");
        scene.setAttribute("embedded", "");
        scene.setAttribute("xr-mode-ui", "enabled: false");
        scene.setAttribute("renderer", "alpha: true; antialias: true");
        scene.setAttribute(
          "arjs",
          "sourceType: webcam; debugUIEnabled: false; cameraParametersUrl: /vendor/arjs/camera_para.dat",
        );
        const camera = document.createElement("a-entity");
        camera.setAttribute("camera", "");
        camera.id = "camera";
        scene.append(camera);
        ar = mountAR({ scene, roomId, phone: true, onStatus: setStatus });
        host.current.append(scene);
      })
      .catch((e) => setStatus(e.message));
    return () => {
      cancelled = true;
      ar?.dispose();
      scene?.pause?.();
      scene?.renderer?.dispose?.();
      scene?.renderer?.forceContextLoss?.();
      scene?.remove();
    };
  }, [started, roomId]);
  return (
    <main className="page companion-page">
      <div className="eyebrow">AR COMPANION / PHONE</div>
      <h1>폰으로 공간 연결</h1>
      <p role="status">{status}</p>
      <div className="companion-camera" ref={host} />
      {!started ? (
        <button
          className="primary"
          disabled={!roomId}
          onClick={() => setStarted(true)}
        >
          카메라 시작
        </button>
      ) : (
        <button onClick={() => setStarted(false)}>카메라·연결 종료</button>
      )}
      <Link className="button" to={`/room?room_id=${roomId}&ar=companion`}>
        수신 화면 열기 ↗
      </Link>
      <p>
        카메라에서 등록된 마커를 인식하면 같은 방의 XR 화면이 해당 위치로
        이동합니다.
      </p>
      <Link to="/tools">← 도구 목록</Link>
    </main>
  );
}
