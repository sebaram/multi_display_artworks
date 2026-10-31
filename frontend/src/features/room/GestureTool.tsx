import { localizeRoomMessage } from "./messages";
import { useI18n } from "../../app/i18n";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
const directions = [
  "nn",
  "ne",
  "ee",
  "se",
  "ss",
  "sw",
  "ww",
  "nw",
  "ns",
  "sn",
  "ew",
  "we",
  "en",
  "wn",
  "es",
  "ws",
  "up",
  "down",
  "left",
  "right",
];
type Touch = {
  x: number;
  y: number;
  type: "start" | "trace" | "end";
  pressure: number;
};
export default function GestureTool() {
  const { t } = useI18n();
  const directionLabels: Record<string, string> = {
    nn: t("북", "North"), ne: t("북동", "Northeast"), ee: t("동", "East"), se: t("남동", "Southeast"),
    ss: t("남", "South"), sw: t("남서", "Southwest"), ww: t("서", "West"), nw: t("북서", "Northwest"),
    ns: t("북 → 남", "North → South"), sn: t("남 → 북", "South → North"),
    ew: t("동 → 서", "East → West"), we: t("서 → 동", "West → East"),
    en: t("동 → 북", "East → North"), wn: t("서 → 북", "West → North"),
    es: t("동 → 남", "East → South"), ws: t("서 → 남", "West → South"),
    up: t("위", "Up"), down: t("아래", "Down"), left: t("왼쪽", "Left"), right: t("오른쪽", "Right"),
  };
  const [params] = useSearchParams();
  const count = Math.max(1, Math.min(24, Number(params.get("targets")) || 8));
  const [status, setStatus] = useState(t("연결 중…", "Connecting…")),
    [gesture, setGesture] = useState("—"),
    [points, setPoints] = useState<Touch[]>([]),
    [selected, setSelected] = useState("target-0"),
    [assignments, setAssignments] = useState<Record<string, string[]>>({}),
    [log, setLog] = useState<string[]>([]);
  const sock = useRef<Socket | null>(null),
    trace = useRef<Touch[]>([]);
  function record(message: string) {
    setLog((previous) => [message, ...previous].slice(0, 20));
  }
  useEffect(() => {
    let es: EventSource | undefined;
    const socket = io({ transports: ["websocket", "polling"] });
    sock.current = socket;
    function touch(value: Touch) {
      setPoints((p) => [...p.slice(-199), value]);
    }
    function result(value: any) {
      setGesture(value.result_str || "—");
      record(`제스처: ${value.result_str}`);
    }
    socket.on("connect", () => {
      setStatus(t("Socket.IO 연결됨", "Socket.IO connected"));
      socket.emit("gesture_mark.join", {});
      es?.close();
      es = undefined;
    });
    socket.on("disconnect", () => setStatus(t("연결 끊김 · 다시 연결 중", "Disconnected · Reconnecting")));
    socket.on("gesture_mark.touchpoint", touch);
    socket.on("gesture_mark.gesture", result);
    socket.on("gesture_mark.clear", () => setPoints([]));
    socket.on("gesture_mark.target_select", (value) => {
      setSelected(value.target_id);
      record(`원격 선택: ${value.target_id}`);
    });
    socket.on("gesture_mark.state", (value) => {
      if (value.touchpoints) setPoints(value.touchpoints);
      if (value.gesture_result) setGesture(value.gesture_result);
    });
    socket.on("connect_error", () => {
      if (es) return;
      es = new EventSource("/gesture-mark/stream");
      es.onopen = () => setStatus(t("SSE 수신 연결됨", "SSE receiver connected"));
      es.onmessage = (e) => {
        try {
          const value = JSON.parse(e.data);
          if (value.type === "touchpoint") touch(value.data);
          if (value.type === "gesture") result(value.data);
          if(value.touchpoints)setPoints(value.touchpoints);
          if(value.gesture_result)setGesture(value.gesture_result);
          if(value.datatype==='gesture_result')result(value);
          else if(Number.isFinite(value.x)&&Number.isFinite(value.y))touch(value);
        } catch {}
      };
      es.onerror = () => setStatus(t("실시간 연결 오류", "Realtime connection error"));
    });
    return () => {
      es?.close();
      socket.removeAllListeners();
      socket.disconnect();
      sock.current = null;
    };
  }, []);
  useEffect(() => {
    const match = Object.entries(assignments).find(
      ([, steps]) => steps.length && steps.join("_") === gesture,
    );
    if (match) {
      setSelected(match[0]);
      record(`일치: ${match[0]}`);
    }
  }, [gesture, assignments]);
  function point(e: React.PointerEvent<HTMLDivElement>, type: Touch["type"]) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(-1, Math.min(1, (2 * (e.clientX - r.left)) / r.width - 1)),
      y: Math.max(-1, Math.min(1, (2 * (e.clientY - r.top)) / r.height - 1)),
      type,
      pressure: type === "start" ? 0.8 : type === "end" ? 0.3 : 0.5,
    };
  }
  function send(value: Touch) {
    trace.current.push(value);
    setPoints((p) => [...p.slice(-199), value]);
    sock.current?.emit("gesture_mark.touchpoint", value);
  }
  function end(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    send(point(e, "end"));
    e.currentTarget.releasePointerCapture(e.pointerId);
    const first = trace.current[0],
      last = trace.current.at(-1);
    if (first && last) {
      const dx = last.x - first.x,
        dy = last.y - first.y;
      const result =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up";
      sock.current?.emit("gesture_mark.gesture", { result_str: result });
      setGesture(result);
    }
    trace.current = [];
  }
  return (
    <main className="page gesture-page">
      <div className="eyebrow">{t("입력 실험실 / 제스처 마크", "INPUT LAB / GESTURE MARK")}</div>
      <h1>{t("제스처 · 터치포인트", "Gestures · Touchpoints")}</h1>
      <p role="status">
        {localizeRoomMessage(status)} · {t("최근 제스처:", "Latest gesture:")} <strong>{gesture}</strong>
      </p>
      <div className="gesture-layout">
        <section>
          <div
            className="gesture-pad"
            tabIndex={0}
            role="application"
            aria-label={t("터치포인트 입력 패드", "Touchpoint input pad")}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              trace.current = [];
              send(point(e, "start"));
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                send(point(e, "trace"));
            }}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {points.map((p, i) => (
              <span
                key={i}
                className={`point-${p.type}`}
                style={{
                  left: `${(p.x + 1) * 50}%`,
                  top: `${(p.y + 1) * 50}%`,
                }}
              />
            ))}
            <p>{t("이 영역을 터치하거나 드래그하세요", "Touch or drag in this area")}</p>
          </div>
          <button
            onClick={() => {
              sock.current?.emit("gesture_mark.clear", {});
              setPoints([]);
              record(t("터치포인트 지움", "Touchpoints cleared"));
            }}
          >
            {t("입력 지우기", "Clear input")}
          </button>
        </section>
        <section>
          <h2>{t("대상 선택 · 제스처 할당", "Select target · Assign gesture")}</h2>
          <div className="target-grid">
            {Array.from({ length: count }, (_, i) => `target-${i}`).map(
              (id, i) => (
                <button
                  className={selected === id ? "selected" : ""}
                  key={id}
                  onClick={() => setSelected(id)}
                >
                  T{i + 1}
                  <small>{assignments[id]?.join(" → ") || t("미할당", "Unassigned")}</small>
                </button>
              ),
            )}
          </div>
          <p>{selected} · {t("단계를 차례로 선택하세요.", "Select the steps in order.")}</p>
          <div className="direction-grid">
            {directions.map((direction) => (
              <button
                key={direction}
                onClick={() =>
                  setAssignments((a) => ({
                    ...a,
                    [selected]: [...(a[selected] || []).slice(-2), direction],
                  }))
                }
              >
                {directionLabels[direction]} <small>{direction}</small>
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button
              onClick={() => setAssignments((a) => ({ ...a, [selected]: [] }))}
            >
              {t("선택 대상 초기화", "Reset selected target")}
            </button>
            <button
              onClick={() =>
                sock.current?.emit("gesture_mark.gesture", {
                  result_str: assignments[selected]?.join("_") || "",
                })
              }
            >
              {t("할당 제스처 보내기", "Send assigned gesture")}
            </button>
          </div>
        </section>
      </div>
      <details>
        <summary>{t("최근 이벤트", "Recent events")}</summary>
        <ul>
          {log.map((line, i) => (
            <li key={i}>{localizeRoomMessage(line)}</li>
          ))}
        </ul>
      </details>
      <Link to="/tools">{t("← 도구 목록", "← Tools")}</Link>
    </main>
  );
}
