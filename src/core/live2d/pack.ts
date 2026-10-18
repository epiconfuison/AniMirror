/**
 * Live2D model packages are multi-file: a `*.model3.json` entry plus a `.moc3`
 * binary, textures and optional physics/pose/expression JSON, each addressed by a
 * path relative to the entry. Everything below is about accepting exactly that and
 * refusing anything the package does not declare.
 */

export const MAX_PACK_FILES = 4096;
export const MAX_PACK_BYTES = 120 * 1024 * 1024;
export const MAX_PACK_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/** Files a Live2D package may contain. Audio and arbitrary executables are refused. */
const ALLOWED_EXTENSIONS = new Set(['moc3', 'png', 'jpg', 'jpeg', 'webp', 'json']);

export interface PackFile { path: string; size: number; bytes(): Promise<ArrayBuffer> }
export interface Live2DPack {
  /** Normalised path of the `*.model3.json` entry inside the pack. */
  entry: string;
  files: Map<string, PackFile>;
  totalBytes: number;
}

/**
 * Normalises a package-relative path. Absolute paths, URL schemes, control characters
 * and `..` segments are rejected outright: nothing outside the selected folder may be
 * referenced, and Windows-style separators are accepted only as separators.
 */
export function normalizePackPath(input: string): string {
  const unified = input.replaceAll('\\', '/').trim();
  if (!unified) throw new Error('模型包含空文件路径。');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(unified)) throw new Error(`模型引用了外部地址 ${unified}；仅支持随模型一起提供的相对资源。`);
  if (unified.startsWith('/')) throw new Error(`模型使用了绝对路径 ${unified}；请使用相对模型入口的资源。`);
  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new Error(`模型资源路径 ${unified} 试图跳出模型目录。`);
    if (/[\u0000-\u001f\u007f]/.test(segment)) throw new Error(`模型资源路径 ${unified} 含有控制字符。`);
    segments.push(segment);
  }
  if (!segments.length) throw new Error('模型包含空文件路径。');
  return segments.join('/');
}

export const dirname = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function extensionOf(path: string): string {
  const name = basename(path).toLowerCase();
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1);
}

/** Resolves a reference inside the manifest against the entry's own directory. */
export function resolveReference(entry: string, reference: string): string {
  const base = dirname(entry);
  const normalized = normalizePackPath(reference);
  const joined = base ? `${base}/${normalized}` : normalized;
  return normalizePackPath(joined);
}

export function isModelManifest(path: string): boolean {
  return basename(path).toLowerCase().endsWith('.model3.json');
}

/** Exactly one manifest is expected; a shallow duplicate is preferred, a real tie is an error. */
export function selectEntry(files: Map<string, PackFile>): string {
  const candidates = [...files.keys()].filter(isModelManifest);
  if (!candidates.length) throw new Error('所选文件夹里没有 .model3.json 主描述文件。请选择包含模型描述文件的整个文件夹。');
  if (candidates.length === 1) return candidates[0]!;
  const depth = (path: string) => path.split('/').length;
  const shallowest = Math.min(...candidates.map(depth));
  const shallow = candidates.filter((path) => depth(path) === shallowest);
  if (shallow.length === 1) return shallow[0]!;
  throw new Error(`所选文件夹包含多个模型描述文件，请只选择一个模型文件夹：${shallow.slice(0, 4).join('、')}`);
}

export async function packFromFiles(input: Iterable<File>): Promise<Live2DPack> {
  const files = new Map<string, PackFile>();
  let totalBytes = 0;
  for (const file of input) {
    const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizePackPath(raw);
    if (files.has(path)) throw new Error(`模型包内存在重复文件 ${path}。`);
    if (files.size >= MAX_PACK_FILES) throw new Error(`模型包文件数超过 ${MAX_PACK_FILES} 个上限。`);
    if (file.size > MAX_PACK_FILE_BYTES) throw new Error(`${basename(path)} 超过单个文件 64 MB 上限。`);
    if (!ALLOWED_EXTENSIONS.has(extensionOf(path))) throw new Error(`模型包含不支持的文件类型 ${path}；仅支持 moc3、贴图与 JSON 描述文件。`);
    totalBytes += file.size;
    if (totalBytes > MAX_PACK_BYTES) throw new Error('模型包总大小超过 120 MB 上限。');
    files.set(path, { path, size: file.size, bytes: () => file.arrayBuffer() });
  }
  if (!files.size) throw new Error('没有选择任何模型文件。');
  const entry = selectEntry(files);
  return { entry, files, totalBytes };
}

export async function readPackBytes(pack: Live2DPack, path: string, maxBytes = MAX_PACK_FILE_BYTES): Promise<ArrayBuffer> {
  const file = pack.files.get(path);
  if (!file) throw new Error(`模型缺少声明的资源 ${path}。`);
  if (file.size > maxBytes) throw new Error(`${basename(path)} 超过允许的大小。`);
  return file.bytes();
}

export async function readPackJson(pack: Live2DPack, path: string, maxBytes = MAX_MANIFEST_BYTES): Promise<unknown> {
  const bytes = await readPackBytes(pack, path, maxBytes);
  if (!bytes.byteLength) throw new Error(`${basename(path)} 为空文件。`);
  try { return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))); }
  catch { throw new Error(`${basename(path)} 不是有效的 JSON。`); }
}
