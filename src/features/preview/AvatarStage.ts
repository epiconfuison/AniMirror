import {
  AmbientLight, Box3, Color, DirectionalLight, Mesh, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMUtils } from '@pixiv/three-vrm';
import { loadAvatar, type LoadedAvatar } from '../../core/avatar/loadAvatar';
import { AvatarDriver } from '../../core/avatar/AvatarDriver';
import type { DriveOutput } from '../../core/contracts';

/** Owns all per-frame state; React only receives the optional one-second FPS summary. */
export class AvatarStage {
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(32, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private driver?: AvatarDriver;
  private loaded?: LoadedAvatar;
  private framing: 'head' | 'half' = 'half';
  private animation = 0;
  private loadGeneration = 0;
  private disposed = false;
  private lastTime = 0;
  private fpsTime = 0;
  private fpsFrames = 0;

  constructor(private readonly container: HTMLElement, private readonly onFps?: (fps: number) => void, private readonly onRendered?: (nowMs: number) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'VRM 角色三维预览；拖动旋转，滚轮缩放');
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new Color('#dce9e5');
    this.scene.add(new AmbientLight(0xffffff, 1.9));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    const fill = new DirectionalLight(0xc4d9ff, 1.2);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);
    this.camera.position.set(0, 1.4, 2.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.3, 0);
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 15;
    this.controls.update();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animation = requestAnimationFrame(this.tick);
  }

  async load(file: File, onProgress?: (percent: number) => void) {
    const generation = ++this.loadGeneration;
    const next = await loadAvatar(file, percent => { if (!this.disposed && generation === this.loadGeneration) onProgress?.(percent); });
    if (this.disposed || generation !== this.loadGeneration) {
      VRMUtils.deepDispose(next.vrm.scene);
      throw new Error('模型加载已被取消。');
    }
    // The current model remains live until all candidate parsing and inspection succeed.
    const previous = this.loaded;
    this.loaded = next;
    this.driver = new AvatarDriver(next.vrm);
    // Relax the default T-pose for a useful half-body portrait.
    const armAxis = next.capabilities.version === '0' ? 1 : -1;
    next.vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, armAxis * 1.05);
    next.vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, -armAxis * 1.05);
    next.vrm.update(0);
    this.scene.add(next.vrm.scene);
    this.resetView();
    if (previous) { this.scene.remove(previous.vrm.scene); VRMUtils.deepDispose(previous.vrm.scene); }
    return { asset: next.asset, capabilities: next.capabilities };
  }

  apply(output: DriveOutput): void {
    this.driver?.apply(output);
  }

  setFraming(framing: 'head' | 'half'): void { this.framing = framing; this.resetView(); }
  setBackground(color: string): void { if (/^#[0-9a-f]{6}$/i.test(color)) this.scene.background = new Color(color); }

  resetView(): void {
    const vrm = this.loaded?.vrm;
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const bounds = new Box3();
    vrm.scene.traverse(node => { if (node instanceof Mesh) bounds.expandByObject(node, true); });
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new Vector3());
    const head = vrm.humanoid.getRawBoneNode('head')?.getWorldPosition(new Vector3()) ?? bounds.getCenter(new Vector3());
    const height = Math.max(size.y, 0.2);
    const portraitHeight = height * (this.framing === 'head' ? 0.32 : 0.68);
    // Include the actual mesh top (hair / accessories), leaving visible headroom.
    const centerY = bounds.max.y + height * 0.045 - portraitHeight * 0.5;
    const distance = portraitHeight / (2 * Math.tan(this.camera.fov * Math.PI / 360)) * Math.max(1, 0.72 / this.camera.aspect);
    this.controls.target.set(head.x, centerY, head.z);
    this.camera.position.set(head.x, centerY + portraitHeight * 0.035, head.z + distance);
    this.camera.near = Math.max(0.001, height * 0.005);
    this.camera.far = Math.max(100, height * 20);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = height * 0.12;
    this.controls.maxDistance = height * 8;
    this.controls.update();
    this.controls.saveState();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    if (!this.fpsTime) this.fpsTime = now;
    const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = now;
    this.controls.update();
    this.loaded?.vrm.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.onRendered?.(performance.now());
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
    this.loadGeneration++;
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.loaded) VRMUtils.deepDispose(this.loaded.vrm.scene);
    this.loaded = undefined;
    this.driver = undefined;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
