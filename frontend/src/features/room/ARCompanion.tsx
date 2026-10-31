import { localizeRoomMessage } from "./messages";
import { useI18n } from "../../app/i18n";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadAFrame } from "../../scene/mountRoom";
import { loadAR, mountAR } from "../../scene/ar";
export default function ARCompanion() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const roomId = params.get("room_id") || "";
  const [status, setStatus] = useState(
      t("카메라 시작을 누르면 권한을 요청합니다.", "Press Start camera to request camera permission."),
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
      <div className="eyebrow">{t("AR 컴패니언 / 휴대폰", "AR COMPANION / PHONE")}</div>
      <h1>{t("폰으로 공간 연결", "Connect your space with a phone")}</h1>
      <p role="status">{localizeRoomMessage(status)}</p>
      <div className="companion-camera" ref={host} />
      {!started ? (
        <button
          className="primary"
          disabled={!roomId}
          onClick={() => setStarted(true)}
        >
          {t("카메라 시작", "Start camera")}
        </button>
      ) : (
        <button onClick={() => setStarted(false)}>{t("카메라·연결 종료", "Stop camera and disconnect")}</button>
      )}
      <Link className="button" to={`/room?room_id=${roomId}&ar=companion`}>
        {t("수신 화면 열기 ↗", "Open receiving view ↗")}
      </Link>
      <p>
        {t("카메라에서 등록된 마커를 인식하면 같은 방의 XR 화면이 해당 위치로 이동합니다.", "When the camera recognizes a registered marker, the XR view in the same room moves to its position.")}
      </p>
      <Link to="/tools">{t("← 도구 목록", "← Tools")}</Link>
    </main>
  );
}
