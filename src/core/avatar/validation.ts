export const MAX_AVATAR_BYTES = 100 * 1024 * 1024;
export const MAX_AVATAR_VERTICES = 5_000_000;

type JsonObject = Record<string, unknown>;
export interface ValidatedVRM { json: JsonObject; version: '0' | '1'; vertexCount: number }
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Inspect the complete local container before GLTFLoader can resolve any resources. */
export function validateVRMBuffer(buffer: ArrayBuffer, fileName = 'avatar.vrm'): ValidatedVRM {
  if (!fileName.toLowerCase().endsWith('.vrm')) throw new Error('请选择 .vrm 文件；首版不支持 GLB、FBX 或 MMD。');
  if (buffer.byteLength > MAX_AVATAR_BYTES) throw new Error('模型超过 100 MB 上限，请先减少贴图或网格规模。');
  if (buffer.byteLength < 20) throw new Error('模型文件不完整：缺少 GLB 文件头。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('文件内容不是受支持的 GLB 2.0 VRM，修改后缀不能转换模型。');
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('模型长度与文件头不符，文件可能损坏或下载不完整。');
  let offset = 12;
  let json: JsonObject | undefined;
  let binaryBytes = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw new Error('模型包含不完整的数据块。');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('模型数据块长度无效。');
    if (offset === 12 && type !== 0x4e4f534a) throw new Error('模型首个数据块必须为 JSON。');
    if (type === 0x4e4f534a) {
      if (json) throw new Error('模型包含重复的 JSON 数据块。');
      try { json = object(JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length)))); }
      catch { throw new Error('模型 JSON 无法读取。'); }
    } else if (type === 0x004e4942) {
      if (binaryBytes) throw new Error('模型包含重复的二进制数据块。');
      binaryBytes = length;
    }
    offset += 8 + length;
  }
  if (!json || object(json.asset).version !== '2.0') throw new Error('模型缺少有效 glTF 2.0 资源声明。');
  const extensions = object(json.extensions);
  const version: '0' | '1' = extensions.VRMC_vrm ? '1' : '0';
  const vrm = object(version === '1' ? extensions.VRMC_vrm : extensions.VRM);
  if (!Object.keys(vrm).length) throw new Error('文件缺少 VRM 扩展，无法作为角色导入。');
  if (version === '1' && vrm.specVersion !== '1.0') throw new Error('仅支持正式版 VRM 1.0 和 VRM 0.x；请重新导出此模型。');
  if (version === '0' && vrm.specVersion !== undefined && !/^0\./.test(String(vrm.specVersion))) throw new Error('此旧版 VRM 的版本声明无效，请重新导出模型。');
  const nodes = array(json.nodes);
  if (!nodes.length || nodes.length > 50_000) throw new Error('模型节点缺失或数量超过 50,000。');
  const humanBones = object(vrm.humanoid).humanBones;
  const bones = version === '1' ? object(humanBones) : Object.fromEntries(array(humanBones).map(bone => [object(bone).bone, bone]));
  for (const required of ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']) {
    const node = object(bones[required]).node;
    if (!Number.isInteger(node) || (node as number) < 0 || (node as number) >= nodes.length) throw new Error(`模型缺少有效的人形骨骼：${required}。请导入完整人形 VRM。`);
  }
  // Walk extensions as well: resource references may occur outside standard buffers/images.
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    for (const [key, child] of Object.entries(object(value))) {
      if (key.toLowerCase() === 'uri' && typeof child === 'string' && !/^data:/i.test(child)) throw new Error('模型引用了外部资源。请导出贴图和网格全部内嵌的自包含 VRM。');
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(json);
  const buffers = array(json.buffers);
  if (!buffers.length) throw new Error('模型缺少网格二进制资源。');
  let resourceBytes = 0;
  for (const [index, raw] of buffers.entries()) {
    const item = object(raw);
    if (!Number.isInteger(item.byteLength) || (item.byteLength as number) < 0 || (item.byteLength as number) > MAX_AVATAR_BYTES) throw new Error('模型声明的资源规模无效或超过上限。');
    if (!item.uri && (index !== 0 || (item.byteLength as number) > binaryBytes)) throw new Error('模型内嵌二进制资源缺失或被截断。');
    resourceBytes += item.byteLength as number;
    if (resourceBytes > MAX_AVATAR_BYTES) throw new Error('模型声明的二进制资源总规模超过 100 MB。');
  }
  for (const raw of array(json.bufferViews)) {
    const item = object(raw), offset = item.byteOffset ?? 0;
    const bufferIndex = item.buffer;
    if (!Number.isInteger(bufferIndex) || (bufferIndex as number) < 0 || (bufferIndex as number) >= buffers.length || !Number.isInteger(offset) || (offset as number) < 0 || !Number.isInteger(item.byteLength) || (item.byteLength as number) < 0 || (offset as number) + (item.byteLength as number) > (object(buffers[bufferIndex as number]).byteLength as number)) throw new Error('模型 bufferView 引用了无效或越界的资源。');
  }
  const accessors = array(json.accessors);
  let vertexCount = 0;
  for (const mesh of array(json.meshes)) for (const primitive of array(object(mesh).primitives)) {
    if (array(object(primitive).targets).length > 128) throw new Error('单网格形变超过 128 个，超出首版支持的资源规模。');
    const position = object(object(primitive).attributes).POSITION;
    const accessor = Number.isInteger(position) ? object(accessors[position as number]) : {};
    if (!Number.isInteger(accessor.count) || (accessor.count as number) < 1) throw new Error('模型网格缺少有效顶点数据。');
    vertexCount += accessor.count as number;
    if (vertexCount > MAX_AVATAR_VERTICES) throw new Error('模型超过 500 万顶点上限，请简化模型后重试。');
  }
  if (!vertexCount) throw new Error('模型没有可显示的网格。');
  return { json, version, vertexCount };
}

export async function hashAvatar(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
