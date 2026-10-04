import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandObservation, HandSide, TrackFrame } from './gestureTypes';

export type CameraStatus = 'off' | 'requesting' | 'live' | 'denied' | 'notfound' | 'inuse' | 'unsupported' | 'error';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TrackerInfo {
  camera: CameraStatus;
  cameraError: string | null;
  model: ModelStatus;
  /** 0..1 model download progress */
  modelProgress: number;
  modelError: string | null;
  delegate: 'GPU' | 'CPU' | null;
  modelSource: 'local' | 'cdn' | null;
  deviceId: string | null;
  deviceLabel: string;
  facing: 'user' | 'environment' | null;
  width: number;
  height: number;
}

export interface TrackerStats {
  cameraFps: number;
  trackingFps: number;
  inferenceMs: number;
  droppedFrames: number;
  hands: number;
  targetFps: number;
}

export interface TrackerSettings {
  mirror: boolean;
  swapHands: boolean;
  /** user-requested tracking rate; the tracker lowers it automatically on slow devices */
  targetFps: number;
  minDetection: number;
}

const MP_VERSION = __MEDIAPIPE_VERSION__;
/** median GPU inference above this → the CPU path is faster (software rendering, weak iGPU…) */
const GPU_TOO_SLOW_MS = 70;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

type Listener = () => void;

/**
 * WebGL backed by a software rasteriser (SwiftShader, llvmpipe… — e.g. hardware acceleration
 * disabled) makes MediaPipe's GPU delegate thousands of times slower than its CPU (WASM SIMD) path.
 */
export function softwareWebGL(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(renderer) ? renderer : null;
  } catch {
    return 'webgl-error';
  }
}

function supportsRvfc(v: HTMLVideoElement): boolean {
  return typeof (v as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function';
}

interface VideoFrameMeta {
  presentedFrames?: number;
}

/**
 * Camera + MediaPipe HandLandmarker.
 *
 * - The model is fetched by us (progress bar, local first, Google CDN fallback) and created with
 *   the GPU delegate, falling back to CPU.
 * - Inference runs on new camera frames (requestVideoFrameCallback, rAF fallback), throttled to a
 *   target rate that adapts to the device — completely independent from UI rendering.
 * - Landmarks are delivered in DISPLAY space (mirrored when the preview is mirrored) and with the
 *   real handedness (MediaPipe assumes selfie-mirrored input; we feed raw frames, so we swap).
 */
export class HandTracker {
  readonly video: HTMLVideoElement;
  settings: TrackerSettings = { mirror: true, swapHands: false, targetFps: 30, minDetection: 0.5 };
  onFrame: ((frame: TrackFrame) => void) | null = null;
  /** called when the camera stops (hands must be released) */
  onStop: (() => void) | null = null;
  stats: TrackerStats = { cameraFps: 0, trackingFps: 0, inferenceMs: 0, droppedFrames: 0, hands: 0, targetFps: 30 };

  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private modelPromise: Promise<void> | null = null;
  private modelBytes: Uint8Array | null = null;
  private running = false;
  private rvfcHandle = 0;
  private rafHandle = 0;
  private lastVideoTime = -1;
  private lastInference = 0;
  private lastTs = 0;
  private inferenceEma = 0;
  private frameCount = 0;
  private trackCount = 0;
  private lastPresented = 0;
  private dynamicFps = 30;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private gpuFailed = false;
  private gpuSamples: number[] = [];
  private gpuChecked = false;
  private listeners = new Set<Listener>();
  private info: TrackerInfo = {
    camera: 'off',
    cameraError: null,
    model: 'idle',
    modelProgress: 0,
    modelError: null,
    delegate: null,
    modelSource: null,
    deviceId: null,
    deviceLabel: '',
    facing: null,
    width: 0,
    height: 0,
  };

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.className = 'camera-video';
    // Parked off-screen until the stage adopts it: some browsers only decode frames of attached videos.
    const park = document.createElement('div');
    park.className = 'video-park';
    park.appendChild(v);
    document.body.appendChild(park);
    this.video = v;
  }

  getInfo = (): TrackerInfo => this.info;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private patch(p: Partial<TrackerInfo>) {
    this.info = { ...this.info, ...p };
    for (const cb of this.listeners) cb();
  }

  // ------------------------------------------------------------------------------------------
  // Model
  // ------------------------------------------------------------------------------------------

  loadModel(): Promise<void> {
    if (!this.modelPromise) {
      this.modelPromise = this.doLoadModel().catch((err: unknown) => {
        console.error('[tracker] model failed', err);
        this.patch({ model: 'error', modelError: err instanceof Error ? err.message : String(err) });
        this.modelPromise = null; // allow retry
      });
    }
    return this.modelPromise;
  }

  private async fetchModel(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`model HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 7_800_000;
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      this.patch({ modelProgress: Math.min(0.99, received / total) });
    }
    const out = new Uint8Array(received);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    if (out.length < 1_000_000) throw new Error('model file looks truncated');
    return out;
  }

  private async doLoadModel() {
    this.patch({ model: 'loading', modelError: null, modelProgress: 0 });
    const vision = await import('@mediapipe/tasks-vision');
    let source: 'local' | 'cdn' = 'local';
    if (!this.modelBytes) {
      try {
        this.modelBytes = await this.fetchModel(`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`);
      } catch (err) {
        console.warn('[tracker] local model unavailable, using CDN', err);
        source = 'cdn';
        this.modelBytes = await this.fetchModel(CDN_MODEL);
      }
    }
    const create = async (wasmBase: string, delegate: 'GPU' | 'CPU') => {
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
      return vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: this.modelBytes!.slice(), delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: this.settings.minDetection,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    };
    const localWasm = `${import.meta.env.BASE_URL}mediapipe/wasm`;
    if (!this.gpuFailed) {
      const soft = softwareWebGL();
      if (soft) {
        console.info(`[tracker] software WebGL (${soft}) — using the CPU delegate`);
        this.gpuFailed = true;
      }
    }
    const attempts: Array<[string, 'GPU' | 'CPU']> = [
      [localWasm, 'GPU'],
      [localWasm, 'CPU'],
      [CDN_WASM, 'GPU'],
      [CDN_WASM, 'CPU'],
    ];
    let lastErr: unknown = null;
    for (const [wasm, delegate] of attempts) {
      if (delegate === 'GPU' && this.gpuFailed) continue;
      try {
        this.landmarker = await create(wasm, delegate);
        this.patch({ model: 'ready', modelProgress: 1, delegate, modelSource: wasm === CDN_WASM ? 'cdn' : source });
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[tracker] HandLandmarker ${delegate} from ${wasm} failed`, err);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('HandLandmarker could not start');
  }

  /** GPU inference crashed at runtime: rebuild on CPU once. */
  private async fallbackToCpu() {
    if (this.gpuFailed) return;
    this.gpuFailed = true;
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
    this.modelPromise = null;
    await this.loadModel();
    this.inferenceEma = 0;
    this.dynamicFps = this.settings.targetFps;
  }

  // ------------------------------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------------------------------

  async listCameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  async startCamera(deviceId: string | null = null, facing: 'user' | 'environment' = 'user'): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patch({ camera: 'unsupported', cameraError: window.isSecureContext ? 'getUserMedia unavailable' : 'insecure-context' });
      return false;
    }
    this.stopCamera(false);
    this.patch({ camera: 'requesting', cameraError: null });
    const base: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing };
    const attempts: MediaTrackConstraints[] = [
      { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      { ...base, width: { ideal: 640 }, height: { ideal: 480 } },
      deviceId ? {} : base,
    ];
    let stream: MediaStream | null = null;
    let lastErr: unknown = null;
    for (const video of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        break;
      } catch (err) {
        lastErr = err;
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') break;
      }
    }
    if (!stream) {
      const name = (lastErr as DOMException)?.name;
      const camera: CameraStatus =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'notfound'
            : name === 'NotReadableError' || name === 'AbortError'
              ? 'inuse'
              : 'error';
      this.patch({ camera, cameraError: lastErr instanceof Error ? lastErr.message : String(lastErr) });
      return false;
    }

    this.stream = stream;
    const v = this.video;
    v.srcObject = stream;
    try {
      await v.play();
    } catch {
      // play() can be interrupted by a re-attach; metadata wait below still works
    }
    const ok = await new Promise<boolean>((resolve) => {
      if (v.videoWidth > 0) return resolve(true);
      const done = (r: boolean) => {
        clearTimeout(timer);
        v.removeEventListener('loadedmetadata', onMeta);
        resolve(r);
      };
      const onMeta = () => done(true);
      const timer = setTimeout(() => done(v.videoWidth > 0), 5000);
      v.addEventListener('loadedmetadata', onMeta);
    });
    if (!ok) {
      this.stopCamera(false);
      this.patch({ camera: 'error', cameraError: 'no video frames' });
      return false;
    }

    const track = stream.getVideoTracks()[0];
    const s = track?.getSettings?.() ?? {};
    track?.addEventListener('ended', () => {
      if (this.stream === stream) {
        this.stopCamera(false);
        this.patch({ camera: 'error', cameraError: 'camera disconnected' });
      }
    });
    this.patch({
      camera: 'live',
      cameraError: null,
      deviceId: s.deviceId ?? deviceId,
      deviceLabel: track?.label ?? '',
      facing: (s.facingMode as 'user' | 'environment' | undefined) ?? (deviceId ? null : facing),
      width: v.videoWidth,
      height: v.videoHeight,
    });
    this.startLoop();
    return true;
  }

  stopCamera(updateStatus = true): void {
    this.running = false;
    if (this.rvfcHandle && supportsRvfc(this.video)) this.video.cancelVideoFrameCallback(this.rvfcHandle);
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rvfcHandle = 0;
    this.rafHandle = 0;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.stats = { ...this.stats, cameraFps: 0, trackingFps: 0, hands: 0 };
    this.onStop?.();
    if (updateStatus) this.patch({ camera: 'off' });
  }

  get isLive(): boolean {
    return this.info.camera === 'live';
  }

  // ------------------------------------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------------------------------------

  private startLoop() {
    this.running = true;
    this.dynamicFps = this.settings.targetFps;
    this.lastPresented = 0;
    this.statsTimer = setInterval(() => this.tickStats(), 1000);
    this.schedule();
  }

  private schedule() {
    if (!this.running) return;
    const v = this.video;
    if (supportsRvfc(v)) {
      this.rvfcHandle = v.requestVideoFrameCallback((now, meta) => this.onVideoFrame(now, meta));
    } else {
      this.rafHandle = requestAnimationFrame((now) => {
        if (v.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = v.currentTime;
          this.onVideoFrame(now, {});
        } else this.schedule();
      });
    }
  }

  private onVideoFrame(now: number, meta: VideoFrameMeta) {
    if (!this.running) return;
    this.frameCount++;
    if (meta.presentedFrames !== undefined) {
      if (this.lastPresented && meta.presentedFrames > this.lastPresented + 1) this.stats.droppedFrames += meta.presentedFrames - this.lastPresented - 1;
      this.lastPresented = meta.presentedFrames;
    }
    this.infer(now);
    this.schedule();
  }

  private infer(now: number) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.videoWidth === 0) return;
    if (now - this.lastInference < 1000 / this.dynamicFps - 4) return;
    this.lastInference = now;
    const ts = Math.max(this.lastTs + 1, now);
    this.lastTs = ts;
    const t0 = performance.now();
    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(v, ts);
    } catch (err) {
      console.error('[tracker] inference failed', err);
      if (this.info.delegate === 'GPU') void this.fallbackToCpu();
      return;
    }
    const dt = performance.now() - t0;
    this.inferenceEma = this.inferenceEma ? this.inferenceEma * 0.9 + dt * 0.1 : dt;
    if (this.info.delegate === 'GPU' && !this.gpuFailed && !this.gpuChecked) {
      // the first frames include shader compilation; judge the GPU path on the next ones
      this.gpuSamples.push(dt);
      if (this.gpuSamples.length >= 8) {
        const sorted = this.gpuSamples.slice(3).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        this.gpuSamples = [];
        if (median > GPU_TOO_SLOW_MS) {
          console.warn(`[tracker] GPU inference too slow (${median.toFixed(0)} ms) — switching to CPU`);
          void this.fallbackToCpu();
          return;
        }
        this.gpuChecked = true;
      }
    }
    this.trackCount++;
    this.stats.hands = result.landmarks.length;
    if (v.videoWidth !== this.info.width || v.videoHeight !== this.info.height) this.patch({ width: v.videoWidth, height: v.videoHeight });
    this.onFrame?.(this.toFrame(result, now, v.videoWidth / v.videoHeight));
  }

  private toFrame(result: HandLandmarkerResult, t: number, aspect: number): TrackFrame {
    const { mirror, swapHands } = this.settings;
    const hands: HandObservation[] = [];
    const handedness = result.handedness ?? result.handednesses ?? [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const cat = handedness[i]?.[0];
      // MediaPipe labels assume a mirrored (selfie) image; we feed the raw camera frame.
      let side: HandSide = cat?.categoryName === 'Left' ? 'Right' : 'Left';
      if (swapHands) side = side === 'Left' ? 'Right' : 'Left';
      hands.push({
        side,
        score: cat?.score ?? 0,
        landmarks: result.landmarks[i].map((p) => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z })),
      });
    }
    return { t, hands, aspect, mirrored: mirror };
  }

  private tickStats() {
    this.stats.cameraFps = this.frameCount;
    this.stats.trackingFps = this.trackCount;
    this.stats.inferenceMs = this.inferenceEma;
    this.frameCount = 0;
    this.trackCount = 0;
    // adapt the tracking rate to the device: keep inference under ~70 % of the frame budget
    const budget = 1000 / this.dynamicFps;
    if (this.inferenceEma > budget * 0.7 && this.dynamicFps > 12) this.dynamicFps = Math.max(12, this.dynamicFps - 5);
    else if (this.inferenceEma < budget * 0.35 && this.dynamicFps < this.settings.targetFps) this.dynamicFps = Math.min(this.settings.targetFps, this.dynamicFps + 5);
    this.stats.targetFps = this.dynamicFps;
  }
}
