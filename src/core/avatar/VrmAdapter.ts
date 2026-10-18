import {
  AmbientLight, Box3, Color, DirectionalLight, Mesh, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { DriveOutput, VrmCapabilities } from '../contracts';
import type { AdapterContext, LoadedModel, ModelAdapter, ModelLoader } from '../adapters/adapter';
import { LoadCancelledError } from '../adapters/adapter';
import { AvatarDriver } from './AvatarDriver';
import { loadAvatar } from './loadAvatar';

/**
 * VRM preview adapter. It owns its Three.js renderer, scene, camera and controls, so
 * the previous VRM rendering and driving chain stays exactly as it was; the stage only
 * forwards frames, size changes and lifecycle events.
 */
export class VrmAdapter implements ModelAdapter {
  readonly format = 'vrm' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(32, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly driver: AvatarDriver;
  private framing: 'head' | 'half';
  private width = 1;
  private height = 1;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    readonly vrm: VRM,
    readonly capabilities: VrmCapabilities,
    framing: 'head' | 'half',
    background: string,
  ) {
    this.framing = framing;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.canvas.setAttribute('aria-label', 'VRM 角色三维预览；拖动旋转，滚轮缩放');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    this.scene.background = new Color(background);
    this.scene.add(new AmbientLight(0xffffff, 1.9));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    const fill = new DirectionalLight(0xc4d9ff, 1.2);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);
    this.camera.position.set(0, 1.4, 2.6);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.3, 0);
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 15;
    this.controls.update();
    this.driver = new AvatarDriver(vrm);
    // Relax the default T-pose for a useful half-body portrait.
    const armAxis = capabilities.version === '0' ? 1 : -1;
    vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, armAxis * 1.05);
    vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, -armAxis * 1.05);
    vrm.update(0);
    this.scene.add(vrm.scene);
    // Size notifications arrive from the shared stage; the adapter never observes on its own.
    this.resize();
    this.resetView();
  }

  apply(output: DriveOutput): void { this.driver.apply(output); }

  update(deltaMs: number): void { this.vrm.update(Math.max(0, deltaMs) / 1000); }

  render(): void {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize(width?: number, height?: number, pixelRatio?: number): void {
    this.width = Math.max(1, width ?? this.container.clientWidth);
    this.height = Math.max(1, height ?? this.container.clientHeight);
    if (pixelRatio) this.renderer.setPixelRatio(Math.min(pixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setFraming(framing: 'head' | 'half'): void { this.framing = framing; this.resetView(); }

  setBackground(color: string): void { if (/^#[0-9a-f]{6}$/i.test(color)) this.scene.background = new Color(color); }

  resetView(): void {
    const { vrm } = this;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.dispose();
    VRMUtils.deepDispose(this.scene);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

/** Load a VRM file into a ready adapter. The candidate is discarded if selection moved on. */
export async function loadVrmModel(file: File, context: AdapterContext): Promise<LoadedModel> {
  const loaded = await loadAvatar(file, percent => context.onProgress(percent));
  if (context.isStale()) {
    VRMUtils.deepDispose(loaded.vrm.scene);
    throw new LoadCancelledError();
  }
  let adapter: VrmAdapter | undefined;
  try {
    adapter = new VrmAdapter(context.container, loaded.vrm, loaded.capabilities, context.framing, context.background);
  } catch (error) {
    VRMUtils.deepDispose(loaded.vrm.scene);
    throw error;
  }
  return { asset: loaded.asset, capabilities: loaded.capabilities, adapter };
}

export const vrmModelLoader = (file: File): ModelLoader => context => loadVrmModel(file, context);
