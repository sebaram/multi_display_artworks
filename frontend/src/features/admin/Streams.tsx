import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Hls from "hls.js";
import { api, write } from "../../api/client";
import { useSession } from "../../app/context";
import { useApi, Status } from "../../app/ui";
import {
  useI18n,
  translate as t,
  renderMessage,
  type LocalizedText,
} from "../../app/i18n";
import { displayError } from "../../app/error-message";
type StreamRead = {
  stream_id: string;
  has_playlist: boolean;
  ffmpeg_running: boolean;
  url?: string | null;
};
export default function Streams() {
  useI18n();
  const { session } = useSession();
  const list = useApi<StreamRead[]>(
    session.is_admin ? "/stream/list" : undefined,
  );
  const [id, setId] = useState(
      () => `phone-${crypto.randomUUID().slice(0, 8)}`,
    ),
    [rtsp, setRtsp] = useState(""),
    [audio, setAudio] = useState(false),
    [error, setError] = useState<LocalizedText>(""),
    [status, setStatus] = useState<LocalizedText>(""),
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
            setError([
              "업로드가 지연되어 녹화를 중단했습니다. 연결 상태를 확인하세요.",
              "Recording stopped because uploads are delayed. Check your connection.",
            ]);
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
            if (live.current)
              setStatus([
                "영상 조각을 업로드하고 있습니다.",
                "Uploading video chunks.",
              ]);
          })
          .catch((reason) => {
            if (live.current)
              setError([
                `업로드하지 못했습니다. ${reason.message}`,
                `Upload failed. ${reason.message}`,
              ]);
            stopLocal();
          })
          .finally(() => {
            pending.current--;
          });
      };
      capture.start(2000);
      setRecording(true);
      setStatus([
        "이 기기의 카메라 영상을 전송하고 있습니다.",
        "Streaming this device's camera.",
      ]);
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
        <h1>{t("미디어 스트림", "Media streams")}</h1>
        <p>
          {t(
            "관리자 로그인 후 사용할 수 있습니다.",
            "Sign in as an administrator to use this tool.",
          )}
        </p>
        <Link to="/signin?next=/tools/streams">
          {t("관리자 로그인", "Administrator sign in")}
        </Link>
      </main>
    );
  return (
    <main className="page streams-page">
      <div className="eyebrow">MEDIA / LIVE SOURCES</div>
      <h1>{t("미디어 스트림", "Media streams")}</h1>
      <p>
        {t(
          "폰 카메라와 RTSP 소스를 HLS로 보내고 전시의 영상 URL에 연결하세요.",
          "Stream a phone camera or RTSP source as HLS and use its URL in your exhibition.",
        )}
      </p>
      <Status error={renderMessage(error)} />
      {status && (
        <p role="status" className="notice">
          {renderMessage(status)}
        </p>
      )}
      <div className="tool-grid">
        <section>
          <h2>{t("스트림 설정", "Stream settings")}</h2>
          <label>
            {t("스트림 ID", "Stream ID")}
            <input
              value={id}
              pattern="[A-Za-z0-9_\-]{1,64}"
              disabled={recording}
              onChange={(event) => setId(event.target.value)}
            />
          </label>
          <small>
            {t(
              "영문·숫자·밑줄·하이픈을 사용할 수 있습니다.",
              "Use letters, numbers, underscores or hyphens.",
            )}
          </small>
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
                setStatus([
                  "RTSP 변환을 시작했습니다.",
                  "RTSP conversion started.",
                ]);
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
              {t("RTSP 연결 시작", "Connect RTSP")}
            </button>
          </form>
          <div className="form-section">
            {t("이 기기에서 카메라 보내기", "Stream this device's camera")}
          </div>
          <label className="checkbox-field">
            {t("마이크 소리 포함", "Include microphone audio")}
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
              {t("카메라 전송 시작", "Start camera stream")}
            </button>
          ) : (
            <button
              onClick={() => {
                stopLocal();
                setStatus([
                  "카메라 전송을 종료했습니다.",
                  "Camera stream stopped.",
                ]);
                list.refresh();
              }}
            >
              {t("카메라 전송 종료", "Stop camera stream")}
            </button>
          )}
          <p className="muted">
            {t(
              "카메라 권한은 시작 버튼을 누를 때 요청합니다. 화면을 떠나면 캡처와 트랙을 종료합니다.",
              "Camera permission is requested when you press Start. Leaving this page stops capture and all media tracks.",
            )}
          </p>
        </section>
        <section>
          <div className="section-heading">
            <h2>{t("사용 가능한 스트림", "Available streams")}</h2>
            <button onClick={list.refresh}>{t("새로고침", "Refresh")}</button>
          </div>
          <Status error={list.error} loading={list.loading} />
          {list.data?.map((stream) => (
            <article className="stream-item" key={stream.stream_id}>
              <strong>{stream.stream_id}</strong>
              <small>
                {stream.ffmpeg_running
                  ? t("변환 중", "Converting")
                  : t("정지", "Stopped")}{" "}
                ·{" "}
                {stream.has_playlist
                  ? t("HLS 준비됨", "HLS ready")
                  : t("영상 준비 중", "Preparing video")}
              </small>
              <div className="form-actions">
                {stream.url && (
                  <button onClick={() => setPreview(stream.url!)}>
                    {t("재생 확인", "Preview playback")}
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
                  {t("스트림 중지", "Stop stream")}
                </button>
                {stream.url && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        new URL(stream.url!, location.origin).href,
                      );
                      setStatus([
                        "영상 URL을 복사했습니다. 월의 영상 URL 필드에 붙여 넣으세요.",
                        "Video URL copied. Paste it into the wall's video URL field.",
                      ]);
                    }}
                  >
                    {t("URL 복사", "Copy URL")}
                  </button>
                )}
              </div>
            </article>
          ))}
          {preview && <StreamPlayer url={preview} />}
        </section>
      </div>
      <Link to="/tools">{t("← 도구 목록", "← Back to tools")}</Link>
    </main>
  );
}
export function StreamPlayer({ url }: { url: string }) {
  useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<LocalizedText>("");
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
        if (!response.ok)
          throw Error(
            t("HLS 준비 중 ({status})", "Preparing HLS ({status})", {
              status: response.status,
            }),
          );
        if (controller.signal.aborted) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(element);
        } else if (element.canPlayType("application/vnd.apple.mpegurl"))
          element.src = url;
        else
          throw Error(
            t(
              "이 브라우저는 HLS 재생을 지원하지 않습니다.",
              "This browser does not support HLS playback.",
            ),
          );
        setWaiting(false);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (++attempts < 30) retry = setTimeout(() => void connect(), 1000);
        else {
          setWaiting(false);
          setError([
            `스트림에 연결하지 못했습니다. ${(reason as Error).message}`,
            `Could not connect to the stream. ${(reason as Error).message}`,
          ]);
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
      {waiting && (
        <p role="status">
          {t("HLS 영상을 준비하고 있습니다…", "Preparing HLS video…")}
        </p>
      )}
      {error && (
        <p role="status" className="error">
          {displayError(renderMessage(error))}
        </p>
      )}
      <video
        ref={video}
        controls
        playsInline
        className="stream-preview"
        aria-label={t("HLS 스트림 재생 확인", "HLS stream playback preview")}
      />
    </>
  );
}
