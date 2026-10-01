import type { TrackingFrame } from '../contracts';
import { cameraErrorMessage } from './errors';
import { FrameGate, toTrackingFrame } from './result';

export type CameraState = 'idle' | 'starting' | 'running' | 'paused' | 'error';
export interface CameraCallbacks {
  onFrame: (frame: TrackingFrame) => void;
  onState: (state: CameraState) => void;
  onError?: (message: string) => void;
}

export class CameraController {
  state: CameraState = 'idle';
  private stream?: MediaStream;
  private worker?: Worker;
  private generation = 0;
  private animation?: number;
  private timeout?: ReturnType<typeof setTimeout>;
  private cancelInitialization?: () => void;
  private gate = new FrameGate();
  private lastVideoTime = -1;
  private lastCapture = -Infinity;
  private disposed = false;

  constructor(private video: HTMLVideoElement, private callbacks: CameraCallbacks) {}

  private setState(state: CameraState): void { this.state = state; this.callbacks.onState(state); }

  async start(deviceId?: string): Promise<void> {
    if (this.disposed) return;
    this.stop();
    const generation = this.generation;
    this.callbacks.onError?.('');
    this.setState('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不能访问摄像头。请使用 Chrome / Edge 并通过 localhost 或 HTTPS 打开。');
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
        throw new Error('此浏览器缺少后台追踪能力，请使用最新版桌面 Chrome / Edge。');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
      } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation === this.generation) this.fail('摄像头已断开。请连接设备后重新选择并开始。');
      }, { once: true }));
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      if (generation !== this.generation) return;
      const worker = new Worker(new URL('./face.worker.ts', import.meta.url));
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => settle(new Error('追踪器启动超时。请检查本地模型资源，然后重试。')), 30000);
        const settle = (error?: Error) => {
          clearTimeout(timer);
          this.cancelInitialization = undefined;
          error ? reject(error) : resolve();
        };
        this.cancelInitialization = () => settle(new DOMException('Startup cancelled', 'AbortError'));
        worker.onerror = event => settle(new Error(event.message || '后台追踪器启动失败。'));
        worker.onmessage = event => {
          if (event.data.type === 'ready') settle();
          if (event.data.type === 'error') settle(new Error(event.data.message));
        };
        const assetsBase = new URL(`${import.meta.env.BASE_URL}tracking-assets/`, location.href).href;
        worker.postMessage({ type: 'init', assetsBase });
      });
      if (generation !== this.generation) return;
      worker.onerror = event => this.fail(event.message || '后台追踪器发生错误，请重试。');
      worker.onmessage = event => {
        if (generation !== this.generation) return;
        clearTimeout(this.timeout);
        this.gate.release();
        if (event.data.type === 'error') { this.fail(event.data.message); return; }
        if (event.data.type === 'result' && this.state === 'running') {
          this.callbacks.onFrame(toTrackingFrame(event.data.result, event.data.timestamp, event.data.inferenceMs));
        }
      };
      this.setState('running');
      this.schedule(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(cameraErrorMessage(error));
    }
  }

  private schedule(generation: number): void {
    this.animation = requestAnimationFrame(() => {
      if (generation !== this.generation || this.state !== 'running') return;
      this.schedule(generation);
      const timestamp = performance.now();
      if (timestamp - this.lastCapture < 1000 / 30 || this.video.readyState < 2 ||
          this.video.currentTime === this.lastVideoTime || !this.gate.acquire(timestamp)) return;
      this.lastVideoTime = this.video.currentTime;
      this.lastCapture = timestamp;
      const worker = this.worker;
      // The gate remains held during bitmap creation. No queue accumulates.
      void createImageBitmap(this.video, { resizeWidth: 640, resizeHeight: Math.round(640 * this.video.videoHeight / this.video.videoWidth) }).then(bitmap => {
        if (generation !== this.generation || this.state !== 'running' || !worker) {
          bitmap.close();
          if (generation === this.generation) this.gate.release();
          return;
        }
        this.timeout = setTimeout(() => this.fail('追踪处理超时，请停止后重试。'), 10000);
        try { worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]); }
        catch (error) { bitmap.close(); this.fail(cameraErrorMessage(error)); }
      }).catch(error => { if (generation === this.generation) this.fail(cameraErrorMessage(error)); });
    });
  }

  pause(): void {
    if (this.state !== 'running') return;
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.worker || !this.stream) return;
    this.setState('running');
    this.schedule(this.generation);
  }

  stop(): void {
    this.generation++;
    this.cancelInitialization?.();
    this.cancelInitialization = undefined;
    if (this.animation !== undefined) cancelAnimationFrame(this.animation);
    this.animation = undefined;
    clearTimeout(this.timeout);
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = undefined;
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.video.pause();
    this.video.srcObject = null;
    this.gate.reset();
    this.lastVideoTime = -1;
    this.lastCapture = -Infinity;
    this.setState('idle');
  }

  private fail(message: string): void {
    this.stop();
    this.callbacks.onError?.(message);
    this.setState('error');
  }

  dispose(): void { this.stop(); this.disposed = true; }
}
