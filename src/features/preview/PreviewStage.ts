import type { DriveOutput, ModelAsset, ModelCapabilities } from '../../core/contracts';
import { LoadCancelledError, type AdapterContext, type ModelAdapter, type ModelLoader } from '../../core/adapters/adapter';

/**
 * Owns the single application animation loop, the host element and the model
 * transaction. It knows nothing about VRM or Cubism: adapters bring their own
 * renderer and canvas, and the stage only forwards frames, size and lifecycle.
 */
export class PreviewStage {
  private adapter?: ModelAdapter;
  private animation = 0;
  private generation = 0;
  private disposed = false;
  private lastTime = 0;
  private fpsTime = 0;
  private fpsFrames = 0;
  private framing: 'head' | 'half' = 'half';
  private background = '#dce9e5';
  private readonly resizeObserver: ResizeObserver;
  private progress?: (percent: number) => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly onFps?: (fps: number) => void,
    private readonly onRendered?: (nowMs: number) => void,
  ) {
    this.container.style.background = this.background;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.animation = requestAnimationFrame(this.tick);
  }

  get current(): ModelAdapter | undefined { return this.adapter; }
  get isDisposed(): boolean { return this.disposed; }

  /**
   * Loads a candidate model and swaps it in only after it is fully ready. The current
   * model keeps running meanwhile; superseded candidates are disposed here.
   */
  async load(loader: ModelLoader, onProgress?: (percent: number) => void): Promise<{ asset: ModelAsset; capabilities: ModelCapabilities }> {
    if (this.disposed) throw new LoadCancelledError();
    const generation = ++this.generation;
    this.progress = onProgress;
    const context: AdapterContext = {
      container: this.container,
      framing: this.framing,
      background: this.background,
      onProgress: (percent) => {
        if (!this.disposed && generation === this.generation) this.progress?.(percent);
      },
      isStale: () => this.disposed || generation !== this.generation,
    };
    let next;
    try {
      next = await loader(context);
    } finally {
      if (generation === this.generation) this.progress = undefined;
    }
    if (this.disposed || generation !== this.generation) {
      next.adapter.dispose();
      throw new LoadCancelledError();
    }
    const previous = this.adapter;
    this.adapter = next.adapter;
    this.resize();
    next.adapter.setFraming(this.framing);
    next.adapter.setBackground(this.background);
    previous?.dispose();
    return { asset: next.asset, capabilities: next.capabilities };
  }

  apply(output: DriveOutput): void {
    if (this.disposed) return;
    this.adapter?.apply(output);
  }

  setFraming(framing: 'head' | 'half'): void { this.framing = framing; this.adapter?.setFraming(framing); }

  setBackground(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    this.background = color;
    this.container.style.background = color;
    this.adapter?.setBackground(color);
  }

  resetView(): void { this.adapter?.resetView(); }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.adapter?.resize(width, height, window.devicePixelRatio || 1);
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    if (!this.fpsTime) this.fpsTime = now;
    const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = now;
    const adapter = this.adapter;
    if (adapter) {
      adapter.update(delta * 1000);
      adapter.render();
      this.onRendered?.(performance.now());
    }
    this.fpsFrames++;
    if (now - this.fpsTime >= 1000) {
      this.onFps?.(Math.round(this.fpsFrames * 1000 / (now - this.fpsTime)));
      this.fpsFrames = 0;
      this.fpsTime = now;
    }
    this.animation = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    this.adapter?.dispose();
    this.adapter = undefined;
  }
}
