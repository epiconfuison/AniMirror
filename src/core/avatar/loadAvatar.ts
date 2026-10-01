import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AvatarAsset, AvatarCapabilities } from '../contracts';
import { inspectAvatar } from './capabilities';
import { hashAvatar, MAX_AVATAR_BYTES, validateVRMBuffer } from './validation';

export interface LoadedAvatar { vrm: VRM; asset: AvatarAsset; capabilities: AvatarCapabilities }

export async function loadAvatar(file: File, onProgress: (percent: number) => void = () => {}): Promise<LoadedAvatar> {
  if (file.size > MAX_AVATAR_BYTES) throw new Error('模型超过 100 MB 上限，请先减少贴图或网格规模。');
  onProgress(5);
  const buffer = await file.arrayBuffer();
  const validated = validateVRMBuffer(buffer, file.name);
  onProgress(20);
  const assetId = await hashAvatar(buffer);
  onProgress(35);
  const manager = new LoadingManager();
  // All allowed blob URLs are created by GLTFLoader from already validated embedded bytes.
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw new Error('已阻止模型访问外部资源。请使用自包含 VRM。');
  });
  const loader = new GLTFLoader(manager);
  loader.register(parser => new VRMLoaderPlugin(parser));
  let vrm: VRM | undefined;
  try {
    const gltf = await loader.parseAsync(buffer, '');
    vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('VRM 扩展加载失败，文件可能缺少必要人形结构。'); }
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse(node => { node.frustumCulled = false; });
    const capabilities = inspectAvatar(vrm, validated.version, file.name.replace(/\.vrm$/i, ''));
    onProgress(100);
    return { vrm, asset: { assetId, file, format: 'vrm', source: 'local', name: capabilities.name }, capabilities };
  } catch (error) {
    if (vrm) VRMUtils.deepDispose(vrm.scene);
    const detail = error instanceof Error ? error.message : '未知加载错误';
    throw new Error(`模型导入失败：${detail}`);
  }
}
