import type { DriveOutput, Live2DCapabilities, Live2DParameterCapability, ModelAsset } from '../contracts';
import type { AdapterContext, LoadedModel, ModelAdapter, ModelLoader } from '../adapters/adapter';
import { LoadCancelledError } from '../adapters/adapter';
import { CubismFramework } from '../../vendor/cubism/framework/live2dcubismframework';
import { CubismIdHandle } from '../../vendor/cubism/framework/id/cubismid';
import { CubismMatrix44 } from '../../vendor/cubism/framework/math/cubismmatrix44';
import { CubismModelMatrix } from '../../vendor/cubism/framework/math/cubismmodelmatrix';
import { CubismMoc } from '../../vendor/cubism/framework/model/cubismmoc';
import { CubismModel } from '../../vendor/cubism/framework/model/cubismmodel';
import { CubismRenderer_WebGL } from '../../vendor/cubism/framework/rendering/cubismrenderer_webgl';
import { CubismWebGLOffscreenManager } from '../../vendor/cubism/framework/rendering/cubismoffscreenmanager';
import { CubismPhysics } from '../../vendor/cubism/framework/physics/cubismphysics';
import { CubismPose } from '../../vendor/cubism/framework/effect/cubismpose';
import { inspectLive2DModel } from './capabilities';
import { hashModelPack } from './identity';
import { readManifest, type Live2DManifest } from './manifest';
import { basename, extensionOf, packFromFiles, readPackBytes, type Live2DPack } from './pack';
import { headParameterValues, parameterValue } from './parameters';
import { ensureCubismRuntime } from './runtime';

type Gl = WebGLRenderingContext | WebGL2RenderingContext;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Cubism angles are degrees; the tracking contract is radians with `x` pitch, `y` yaw, `z` roll. */
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

interface Live2DResources {
  gl: Gl; moc: CubismMoc; model: CubismModel; renderer: CubismRenderer_WebGL;
  textures: WebGLTexture[]; physics?: CubismPhysics; pose?: CubismPose;
}

/**
 * Live2D preview adapter. It owns its canvas, WebGL context, model, textures and physics,
 * while the shared stage owns the animation loop and forwards size/frame events.
 *
 * Parameter writes happen exactly once per frame, right after the saved state is loaded;
 * physics then runs on top of that state, so a mapped value is never written twice.
 */
export class Live2DAdapter implements ModelAdapter {
  readonly format = 'live2d' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly gl: Gl;
  private readonly moc: CubismMoc;
  private readonly model: CubismModel;
  private readonly renderer: CubismRenderer_WebGL;
  private readonly modelMatrix: CubismModelMatrix;
  private readonly textures: WebGLTexture[];
  private readonly physics?: CubismPhysics;
  private readonly pose?: CubismPose;
  private readonly handles = new Map<string, CubismIdHandle>();
  private readonly parameters = new Map<string, Live2DParameterCapability>();
  private output: DriveOutput = { expressions: {}, rotation: { x: 0, y: 0, z: 0 }, tracking: 'lost' };
  private framing: 'head' | 'half';
  private disposed = false;

  private constructor(
    readonly capabilities: Live2DCapabilities,
    resources: Live2DResources,
    manifest: Live2DManifest,
    framing: 'head' | 'half',
  ) {
    this.canvas = resources.gl.canvas as HTMLCanvasElement;
    this.gl = resources.gl;
    this.moc = resources.moc;
    this.model = resources.model;
    this.renderer = resources.renderer;
    this.textures = resources.textures;
    this.physics = resources.physics;
    this.pose = resources.pose;
    this.modelMatrix = new CubismModelMatrix(this.model.getCanvasWidth(), this.model.getCanvasHeight());
    if (Object.keys(manifest.layout).length) this.modelMatrix.setupFromLayout(new Map(Object.entries(manifest.layout)));
    this.framing = framing;
    for (const parameter of this.capabilities.parameters) {
      this.parameters.set(parameter.id, parameter);
      this.handles.set(parameter.id, CubismFramework.getIdManager().getId(parameter.id));
    }
  }

  apply(output: DriveOutput): void { this.output = output; }

  update(deltaMs: number): void {
    if (this.disposed) return;
    const seconds = clamp(deltaMs, 0, 100) / 1000;
    // Restore the pre-physics state, apply the composed drive result, then let physics run.
    this.model.loadParameters();
    this.writeParameters();
    this.model.saveParameters();
    this.physics?.evaluate(this.model, seconds);
    this.pose?.updateParameters(this.model, seconds);
    this.model.update();
  }

  render(): void {
    if (this.disposed) return;
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const width = this.canvas.width, height = this.canvas.height;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const matrix = new CubismMatrix44();
    matrix.setMatrix(this.projection().getArray());
    matrix.multiplyByMatrix(this.modelMatrix);
    const manager = CubismWebGLOffscreenManager.getInstance();
    manager.beginFrameProcess(gl);
    this.renderer.setMvpMatrix(matrix);
    // The framework types the default framebuffer as non-null even though null is valid.
    this.renderer.setRenderState(null as unknown as WebGLFramebuffer, [0, 0, width, height]);
    this.renderer.drawModel();
    manager.endFrameProcess(gl);
    manager.releaseStaleRenderTextures(gl);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return;
    const ratio = clamp(pixelRatio || 1, 1, 2);
    const pixelsW = Math.max(1, Math.round(width * ratio));
    const pixelsH = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pixelsW || this.canvas.height !== pixelsH) {
      this.canvas.width = pixelsW;
      this.canvas.height = pixelsH;
    }
    this.canvas.style.width = `${Math.max(1, Math.round(width))}px`;
    this.canvas.style.height = `${Math.max(1, Math.round(height))}px`;
    this.gl.viewport(0, 0, pixelsW, pixelsH);
    this.renderer.setRenderTargetSize(pixelsW, pixelsH);
  }

  setFraming(framing: 'head' | 'half'): void { this.framing = framing; this.resetView(); }

  /** The canvas is transparent, so the stage background shows through. */
  setBackground(_color: string): void { /* handled by the shared stage container */ }

  resetView(): void { this.render(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.length = 0;
    this.renderer.release();
    if (this.physics) CubismPhysics.delete(this.physics);
    if (this.pose) CubismPose.delete(this.pose);
    this.moc.deleteModel(this.model);
    this.moc.release();
    // Freeing the context explicitly keeps repeated model switching below the browser limit.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }

  private writeParameters(): void {
    const write = (id: string, value: number) => {
      const handle = this.handles.get(id);
      const parameter = this.parameters.get(id);
      if (!handle || !parameter) return;
      this.model.setParameterValueById(handle, clamp(Number.isFinite(value) ? value : parameter.default, parameter.min, parameter.max));
    };
    const { rotation } = this.output;
    // Cubism angle parameters are expressed in degrees and already carry the model's limits.
    for (const [id, value] of Object.entries(headParameterValues(rotation))) write(id, value);
    for (const [target, amount] of Object.entries(this.output.expressions)) {
      const parameter = this.parameters.get(target);
      if (!parameter) continue;
      write(target, parameterValue(parameter, amount));
    }
  }

  /**
   * Device projection identical to the SDK sample, plus the optional head close-up. The
   * model matrix (layout, size) is applied afterwards by the renderer entry point.
   */
  private projection(): CubismMatrix44 {
    const { width, height } = this.canvas;
    const projection = new CubismMatrix44();
    if (this.model.getCanvasWidth() > 1.0 && width < height) {
      this.modelMatrix.setWidth(2.0);
      projection.scale(1.0, width / height);
    } else {
      projection.scale(height / width, 1.0);
    }
    if (this.framing === 'head') {
      // Close-up on the head: zoom in and pull the upper part of the artwork to the centre.
      projection.scale(projection.getScaleX() * 1.9, projection.getScaleY() * 1.9);
      projection.translate(0, -0.85);
    }
    return projection;
  }

  static async create(context: AdapterContext, pack: Live2DPack, manifest: Live2DManifest, name: string): Promise<Live2DAdapter> {
    const container = context.container;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Live2D 角色预览');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    let gl: Gl | null = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true }) as Gl | null;
      if (!gl) gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true }) as Gl | null;
    } catch { gl = null; }
    if (!gl) {
      canvas.remove();
      throw new Error('此浏览器无法创建 WebGL 上下文，Live2D 模型无法渲染。');
    }
    let moc: CubismMoc | undefined;
    let model: CubismModel | undefined;
    let renderer: CubismRenderer_WebGL | undefined;
    const textures: WebGLTexture[] = [];
    let physics: CubismPhysics | undefined;
    let pose: CubismPose | undefined;
    const cleanup = () => {
      for (const texture of textures) gl?.deleteTexture(texture);
      renderer?.release();
      if (physics) CubismPhysics.delete(physics);
      if (pose) CubismPose.delete(pose);
      if (moc && model) moc.deleteModel(model);
      moc?.release();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
    try {
      const mocBytes = await readPackBytes(pack, manifest.moc);
      if (!mocBytes.byteLength) throw new Error('moc3 文件为空。');
      context.onProgress(55);
      moc = CubismMoc.create(mocBytes, true) ?? undefined;
      if (!moc) throw new Error('moc3 文件无法解析：文件可能损坏，或由不受支持的 Cubism 版本导出。');
      model = moc.createModel() ?? undefined;
      if (!model) throw new Error('无法从 moc3 创建模型实例。');
      model.saveParameters();
      context.onProgress(65);
      if (manifest.physics) {
        const bytes = await readPackBytes(pack, manifest.physics);
        physics = CubismPhysics.create(bytes, bytes.byteLength) ?? undefined;
      }
      if (manifest.pose) {
        const bytes = await readPackBytes(pack, manifest.pose);
        pose = CubismPose.create(bytes, bytes.byteLength) ?? undefined;
      }
      renderer = new CubismRenderer_WebGL(canvas.width, canvas.height);
      renderer.initialize(model, 1);
      renderer.startUp(gl);
      // Cubism 5-r.x fetches its shader sources; they are published with the app.
      renderer.loadShaders(`${import.meta.env.BASE_URL}vendor/cubism-shaders/`);
      renderer.setIsPremultipliedAlpha(true);
      context.onProgress(75);
      for (const [index, path] of manifest.textures.entries()) {
        const bytes = await readPackBytes(pack, path);
        const texture = await uploadTexture(gl, bytes, extensionOf(path));
        textures.push(texture);
        renderer.bindTexture(index, texture);
        context.onProgress(75 + Math.round(20 * (index + 1) / manifest.textures.length));
        if (context.isStale()) throw new LoadCancelledError();
      }
      const parameters: [string, number, number, number][] = [];
      for (let index = 0; index < model.getParameterCount(); index += 1) {
        const handle = model.getParameterId(index);
        parameters.push([handle.getString(), model.getParameterMinimumValue(index), model.getParameterMaximumValue(index), model.getParameterDefaultValue(index)]);
      }
      const capabilities = inspectLive2DModel({
        name, drawableCount: model.getDrawableCount(), mocVersion: moc.getMocVersion(),
        textureCount: textures.length, parameters, manifest,
      });
      const adapter = new Live2DAdapter(capabilities, {
        gl, moc, model, renderer, textures, physics, pose,
      }, manifest, context.framing);
      adapter.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), window.devicePixelRatio || 1);
      adapter.render();
      context.onProgress(100);
      return adapter;
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}

async function uploadTexture(gl: Gl, bytes: ArrayBuffer, extension: string): Promise<WebGLTexture> {
  const type = IMAGE_TYPES[extension];
  if (!type) throw new Error(`不支持的贴图格式 .${extension || '?'}。`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type }), { premultiplyAlpha: 'premultiply' }); }
  catch { throw new Error('贴图无法解码，文件可能损坏或格式不受支持。'); }
  const texture = gl.createTexture();
  if (!texture) { bitmap.close(); throw new Error('无法创建 WebGL 贴图。'); }
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
  } finally {
    bitmap.close();
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  return texture;
}

/** Loads a Live2D package selected as a folder (or a flat set of files). */
export async function loadLive2DModel(files: File[], context: AdapterContext): Promise<LoadedModel> {
  const pack = await packFromFiles(files);
  context.onProgress(10);
  const manifest = await readManifest(pack);
  context.onProgress(25);
  const assetId = await hashModelPack(pack, manifest.references);
  context.onProgress(40);
  if (context.isStale()) throw new LoadCancelledError();
  ensureCubismRuntime();
  const name = basename(pack.entry).replace(/\.model3\.json$/i, '');
  const asset: ModelAsset = { assetId, name, format: 'live2d', source: 'local', sizeBytes: pack.totalBytes, entry: pack.entry };
  const adapter = await Live2DAdapter.create(context, pack, manifest, name);
  return { asset, capabilities: adapter.capabilities, adapter };
}

/** Loader factory used by the app and by tests: a folder selection of model files. */
export const live2dModelLoader = (files: File[] | FileList): ModelLoader => (context) => loadLive2DModel([...files], context);
