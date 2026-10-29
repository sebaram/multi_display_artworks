/* Paste into the inspected app page's console AFTER entering VR for an XR run.
 * This uses the real XRSession RAF when present, never Window RAF as a VR proxy.
 * Device CPU/GPU utilization and total app RAM require ADB/OVR counters separately.
 */
(async function deviceProbe(seconds = 60) {
  const scene = document.querySelector('a-scene');
  if (!scene?.renderer) throw Error('Open a fully loaded actual exhibition first.');
  const renderer = scene.renderer;
  const xr = renderer.xr.getSession();
  const request = xr ? xr.requestAnimationFrame.bind(xr) : requestAnimationFrame;
  const intervals = [], samples = [], cpu = [];
  const original = renderer.render;
  let frames = 0, first, previous;
  renderer.render = function (...args) {
    if (args[0] !== scene.object3D) return original.apply(this, args);
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { cpu.push(performance.now() - start); frames++; }
  };
  const percentile = (values, p) => {
    if (!values.length) return null;
    const a = [...values].sort((x, y) => x - y), index = (a.length - 1) * p;
    return a[Math.floor(index)] + (a[Math.ceil(index)] - a[Math.floor(index)]) * (index % 1);
  };
  let elapsed;
  try {
    elapsed = await new Promise((resolve, reject) => {
      const tick = now => {
        first ??= now;
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        if (intervals.length % 30 === 0) {
          const gl = renderer.getContext();
          samples.push({ at_ms: now - first, draw_calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures,
            geometries: renderer.info.memory.geometries, js_heap_hint_bytes: performance.memory?.usedJSHeapSize ?? null,
            drawing_buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], visibility: document.visibilityState });
        }
        if (now - first >= seconds * 1000) resolve(now - first);
        else if (glLost()) reject(Error('WebGL context lost during device run'));
        else request(tick);
      };
      const glLost = () => renderer.getContext().isContextLost();
      request(tick);
    });
  } finally {
    renderer.render = original;
  }
  const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const result = { measured_at: new Date().toISOString(), user_agent: navigator.userAgent,
    page: location.pathname + location.search, mode: xr ? 'actual-immersive-xr-session' : 'actual-flat-page',
    duration_ms: elapsed, render_fps: frames * 1000 / elapsed,
    frame_interval_p50_ms: percentile(intervals, .5), frame_interval_p95_ms: percentile(intervals, .95),
    frame_interval_p99_ms: percentile(intervals, .99), render_submit_cpu_p95_ms: percentile(cpu, .95),
    actual_session_frame_rate: xr?.frameRate ?? null, supported_session_frame_rates: xr?.supportedFrameRates ? [...xr.supportedFrameRates] : null,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    cpu_utilization_pct: null, gpu_utilization_pct: null, total_app_ram_bytes: null,
    unavailable_reason: 'Collect ADB browser meminfo/cpuinfo and Quest OVR Metrics alongside this page sample.',
    intervals_ms: intervals, samples };
  window.__lastPerformanceSample = result;
  console.log('DEVICE_PERFORMANCE_JSON', JSON.stringify(result));
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = `device-performance-${Date.now()}.json`; link.textContent = '성능 측정 JSON 다운로드';
  link.style = 'position:fixed;z-index:2147483647;top:16px;left:16px;background:white;padding:16px;color:black';
  document.body.append(link);
  link.addEventListener('click', () => setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 3000), { once: true });
  return result;
})();
