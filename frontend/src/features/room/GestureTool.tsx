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
  const [params] = useSearchParams();
  const count = Math.max(1, Math.min(24, Number(params.get("targets")) || 8));
  const [status, setStatus] = useState("연결 중…"),
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
      setStatus("Socket.IO 연결됨");
      socket.emit("gesture_mark.join", {});
      es?.close();
      es = undefined;
    });
    socket.on("disconnect", () => setStatus("연결 끊김 · 다시 연결 중"));
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
      es.onopen = () => setStatus("SSE 수신 연결됨");
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
      es.onerror = () => setStatus("실시간 연결 오류");
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
      <div className="eyebrow">INPUT LAB / GESTURE MARK</div>
      <h1>제스처 · 터치포인트</h1>
      <p role="status">
        {status} · 최근 제스처: <strong>{gesture}</strong>
      </p>
      <div className="gesture-layout">
        <section>
          <div
            className="gesture-pad"
            tabIndex={0}
            role="application"
            aria-label="터치포인트 입력 패드"
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
            <p>이 영역을 터치하거나 드래그하세요</p>
          </div>
          <button
            onClick={() => {
              sock.current?.emit("gesture_mark.clear", {});
              setPoints([]);
              record("터치포인트 지움");
            }}
          >
            입력 지우기
          </button>
        </section>
        <section>
          <h2>대상 선택 · 제스처 할당</h2>
          <div className="target-grid">
            {Array.from({ length: count }, (_, i) => `target-${i}`).map(
              (id, i) => (
                <button
                  className={selected === id ? "selected" : ""}
                  key={id}
                  onClick={() => setSelected(id)}
                >
                  T{i + 1}
                  <small>{assignments[id]?.join(" → ") || "미할당"}</small>
                </button>
              ),
            )}
          </div>
          <p>{selected} · 단계를 차례로 선택하세요.</p>
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
                {direction}
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button
              onClick={() => setAssignments((a) => ({ ...a, [selected]: [] }))}
            >
              선택 대상 초기화
            </button>
            <button
              onClick={() =>
                sock.current?.emit("gesture_mark.gesture", {
                  result_str: assignments[selected]?.join("_") || "",
                })
              }
            >
              할당 제스처 보내기
            </button>
          </div>
        </section>
      </div>
      <details>
        <summary>최근 이벤트</summary>
        <ul>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
      <Link to="/tools">← 도구 목록</Link>
    </main>
  );
}
