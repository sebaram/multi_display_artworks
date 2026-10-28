import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Hls from "hls.js";
import { api, write } from "../../api/client";
import { useSession } from "../../app/context";
import { useApi, Status } from "../../app/ui";
type StreamRead = {
  stream_id: string;
  has_playlist: boolean;
  ffmpeg_running: boolean;
  url?: string | null;
};
export default function Streams() {
  const { session } = useSession();
  const list = useApi<StreamRead[]>(
    session.is_admin ? "/stream/list" : undefined,
  );
  const [id, setId] = useState(
      () => `phone-${crypto.randomUUID().slice(0, 8)}`,
    ),
    [rtsp, setRtsp] = useState(""),
    [audio, setAudio] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  const camera = useRef<HTMLVideoElement>(null),
    media = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    queue = useRef(Promise.resolve()),
    pending = useRef(0),
    owned = useRef<string | null>(null),
    live = useRef(true);
  const valid = /^[A-Za-z0-9_-]{1,64}$/.test(id);
  function stopLocal() {
    const active = recorder.current;
    recorder.current = null;
    if (active && active.state !== "inactive") active.stop();
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    if (camera.current) camera.current.srcObject = null;
    if (live.current) setRecording(false);
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stopLocal();
      if (owned.current)
        void queue.current
          .catch(() => {})
          .then(() =>
            write(`/stream/stop/${encodeURIComponent(owned.current!)}`, "POST"),
          )
          .catch(() => {});
    };
  }, []);
  async function startCamera() {
    setError("");
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio,
      });
      if (!live.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      if (camera.current) {
        camera.current.srcObject = stream;
        await camera.current.play();
      }
      const mime = [
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recordingId = id;
      const capture = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      let index = 0;
      owned.current = id;
      recorder.current = capture;
      capture.ondataavailable = (event) => {
        if (!event.data.size) return;
        if (pending.current >= 3) {
          if (live.current)
            setError(
              "업로드가 지연되어 녹화를 중단했습니다. 연결 상태를 확인하세요.",
            );
          stopLocal();
          return;
        }
        pending.current++;
        const form = new FormData();
        form.append(
          "chunk",
          event.data,
          `chunk.${event.data.type.includes("mp4") ? "mp4" : "webm"}`,
        );
        form.append("idx", String(index++));
        queue.current = queue.current
          .then(() =>
            api(`/stream/push/${encodeURIComponent(recordingId)}`, {
              method: "POST",
              body: form,
            }),
          )
          .then(() => {
            if (live.current) setStatus("영상 조각을 업로드하고 있습니다.");
          })
          .catch((reason) => {
            if (live.current)
              setError(`업로드하지 못했습니다. ${reason.message}`);
            stopLocal();
          })
          .finally(() => {
            pending.current--;
          });
      };
      capture.start(2000);
      setRecording(true);
      setStatus("이 기기의 카메라 영상을 전송하고 있습니다.");
    } catch (reason) {
      setError((reason as Error).message);
      stopLocal();
    } finally {
      if (live.current) setBusy(false);
    }
  }
  if (!session.is_admin)
    return (
      <main className="page">
        <h1>미디어 스트림</h1>
        <p>관리자 로그인 후 사용할 수 있습니다.</p>
        <Link to="/signin?next=/tools/streams">관리자 로그인</Link>
      </main>
    );
  return (
    <main className="page streams-page">
      <div className="eyebrow">MEDIA / LIVE SOURCES</div>
      <h1>미디어 스트림</h1>
      <p>폰 카메라와 RTSP 소스를 HLS로 보내고 전시의 영상 URL에 연결하세요.</p>
      <Status error={error} />
      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      <div className="tool-grid">
        <section>
          <h2>스트림 설정</h2>
          <label>
            스트림 ID
            <input
              value={id}
              pattern="[A-Za-z0-9_-]{1,64}"
              disabled={recording}
              onChange={(event) => setId(event.target.value)}
            />
          </label>
          <small>영문·숫자·밑줄·하이픈을 사용할 수 있습니다.</small>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                const response = await write("/stream/start-rtsp", "POST", {
                  stream_id: id,
                  rtsp_url: rtsp,
                });
                setStatus("RTSP 변환을 시작했습니다.");
                setPreview(response.url);
                list.refresh();
              } catch (reason) {
                setError((reason as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              RTSP URL
              <input
                type="url"
                required
                placeholder="rtsp://camera.example/stream"
                value={rtsp}
                onChange={(event) => setRtsp(event.target.value)}
              />
            </label>
            <button className="primary" disabled={!valid || busy}>
              RTSP 연결 시작
            </button>
          </form>
          <div className="form-section">이 기기에서 카메라 보내기</div>
          <label className="checkbox-field">
            마이크 소리 포함
            <input
              type="checkbox"
              checked={audio}
              disabled={recording}
              onChange={(event) => setAudio(event.target.checked)}
            />
          </label>
          <video
            ref={camera}
            autoPlay
            muted
            playsInline
            className="stream-preview"
          />
          {!recording ? (
            <button
              className="primary"
              disabled={!valid || busy}
              onClick={() => void startCamera()}
            >
              카메라 전송 시작
            </button>
          ) : (
            <button
              onClick={() => {
                stopLocal();
                setStatus("카메라 전송을 종료했습니다.");
                list.refresh();
              }}
            >
              카메라 전송 종료
            </button>
          )}
          <p className="muted">
            카메라 권한은 시작 버튼을 누를 때 요청합니다. 화면을 떠나면 캡처와
            트랙을 종료합니다.
          </p>
        </section>
        <section>
          <div className="section-heading">
            <h2>사용 가능한 스트림</h2>
            <button onClick={list.refresh}>새로고침</button>
          </div>
          <Status error={list.error} loading={list.loading} />
          {list.data?.map((stream) => (
            <article className="stream-item" key={stream.stream_id}>
              <strong>{stream.stream_id}</strong>
              <small>
                {stream.ffmpeg_running ? "변환 중" : "정지"} ·{" "}
                {stream.has_playlist ? "HLS 준비됨" : "영상 준비 중"}
              </small>
              <div className="form-actions">
                {stream.url && (
                  <button onClick={() => setPreview(stream.url!)}>
                    재생 확인
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      await write(
                        `/stream/stop/${encodeURIComponent(stream.stream_id)}`,
                        "POST",
                      );
                      list.refresh();
                    } catch (reason) {
                      setError((reason as Error).message);
                    }
                  }}
                >
                  스트림 중지
                </button>
                {stream.url && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        new URL(stream.url!, location.origin).href,
                      );
                      setStatus(
                        "영상 URL을 복사했습니다. 월의 영상 URL 필드에 붙여 넣으세요.",
                      );
                    }}
                  >
                    URL 복사
                  </button>
                )}
              </div>
            </article>
          ))}
          {preview && <StreamPlayer url={preview} />}
        </section>
      </div>
      <Link to="/tools">← 도구 목록</Link>
    </main>
  );
}
export function StreamPlayer({ url }: { url: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (!video.current) return;
    const element = video.current;
    let hls: Hls | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const controller = new AbortController();
    setWaiting(true);
    setError("");
    async function connect() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw Error(`HLS 준비 중 (${response.status})`);
        if (controller.signal.aborted) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(element);
        } else if (element.canPlayType("application/vnd.apple.mpegurl"))
          element.src = url;
        else throw Error("이 브라우저는 HLS 재생을 지원하지 않습니다.");
        setWaiting(false);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (++attempts < 30) retry = setTimeout(() => void connect(), 1000);
        else {
          setWaiting(false);
          setError(
            `스트림에 연결하지 못했습니다. ${(reason as Error).message}`,
          );
        }
      }
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
      hls?.destroy();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [url]);
  return (
    <>
      {waiting && <p role="status">HLS 영상을 준비하고 있습니다…</p>}
      {error && (
        <p role="status" className="error">
          {error}
        </p>
      )}
      <video
        ref={video}
        controls
        playsInline
        className="stream-preview"
        aria-label="HLS 스트림 재생 확인"
      />
    </>
  );
}
