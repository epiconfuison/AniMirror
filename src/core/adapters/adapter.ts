import type { DriveOutput, ModelAsset, ModelCapabilities, ModelFormat } from '../contracts';

/**
 * Minimum contract a preview adapter must satisfy. Rendering ownership is explicit:
 * every adapter owns its own renderer, canvas and model resources, while the stage
 * owns the single application animation loop and forwards size/lifecycle events.
 */
export interface ModelAdapter {
  readonly format: ModelFormat;
  readonly capabilities: ModelCapabilities;
  readonly canvas: HTMLCanvasElement;
  /** Single write point per frame: apply the composed drive result. */
  apply(output: DriveOutput): void;
  /** Advance model-internal state (VRM spring bones / Cubism physics). */
  update(deltaMs: number): void;
  /** Draw the current state. Never starts its own animation loop. */
  render(): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setFraming(framing: 'head' | 'half'): void;
  setBackground(color: string): void;
  resetView(): void;
  dispose(): void;
}

export interface AdapterContext {
  /** Host element the adapter may attach its canvas to. */
  readonly container: HTMLElement;
  readonly framing: 'head' | 'half';
  readonly background: string;
  onProgress(percent: number): void;
  /** True once the user selected another model or the stage was disposed. */
  isStale(): boolean;
}

export interface LoadedModel {
  asset: ModelAsset;
  capabilities: ModelCapabilities;
  adapter: ModelAdapter;
}

/** A loader only builds the candidate model; the stage decides when it becomes current. */
export type ModelLoader = (context: AdapterContext) => Promise<LoadedModel>;

export class LoadCancelledError extends Error {
  constructor() {
    super('模型加载已被取消。');
    this.name = 'LoadCancelledError';
  }
}
