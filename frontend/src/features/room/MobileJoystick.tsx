import { useI18n } from "../../app/i18n";
import { useEffect, useRef } from "react";
import { create } from "nipplejs";

export default function MobileJoystick({ disabled, onMove }: {
  disabled: boolean;
  onMove(forward: number, right: number): void;
}) {
  const { t } = useI18n();
  const zone = useRef<HTMLDivElement>(null);
  const move = useRef(onMove);
  move.current = onMove;
  useEffect(() => {
    const node = zone.current!;
    if (disabled) {
      move.current(0, 0);
      return;
    }
    let active = false;
    const stop = () => {
      active = false;
      delete node.dataset.active;
      move.current(0, 0);
    };
    const joystick = create({
      zone: node,
      mode: "dynamic",
      size: 112,
      threshold: 0.1,
      fadeTime: 120,
      multitouch: false,
      follow: false,
      color: { front: "#d4e7e5", back: "#20313d" },
    });
    joystick.on("start", () => {
      active = !document.querySelector('dialog[open], [role="dialog"]');
      if (active) node.dataset.active = "true";
    });
    joystick.on("move", ({ data: { vector } }) => {
      if (!active) return;
      const distance = Math.hypot(vector.x, vector.y);
      if (distance <= 0.1) {
        move.current(0, 0);
      } else {
        const speed = (Math.min(distance, 1) - 0.1) / 0.9;
        move.current(vector.y / distance * speed, vector.x / distance * speed);
      }
    });
    joystick.on("end", stop);
    const onVisibility = () => { if (document.hidden) stop(); };
    const onUI = (event: Event) => {
      if (event.target instanceof Element && !node.contains(event.target) &&
          event.target.closest('button, a, input, select, textarea, dialog, [role="dialog"]')) stop();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    window.addEventListener("resize", stop);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onUI, true);
    document.addEventListener("focusin", onUI);
    return () => {
      stop();
      joystick.destroy();
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("resize", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", onUI, true);
      document.removeEventListener("focusin", onUI);
    };
  }, [disabled]);
  return <div ref={zone} className="mobile-joystick" role="group" aria-label={t("이동 조이스틱", "Movement joystick")}
    aria-disabled={disabled} aria-description={t("드래그 방향과 거리로 이동합니다. 손을 떼면 멈춥니다. 키보드는 WASD 또는 방향키를 사용하세요.", "Drag to move in that direction; drag farther to move faster. Release to stop. Use WASD or arrow keys on a keyboard.")}>
    <div className="joystick-hint" aria-hidden="true"><span>✥</span><small>{t("드래그로 이동", "Drag to move")}</small></div>
  </div>;
}
