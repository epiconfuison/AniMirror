import type { Live2DPack } from './pack';

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Model identity for a multi-file package: the hash of every file the manifest actually
 * uses, keyed by its package path. Two folders with the same entry name but different
 * textures therefore never share a stored profile, and re-selecting the same files
 * always yields the same identity.
 */
export async function hashModelPack(pack: Live2DPack, references: readonly string[]): Promise<string> {
  const paths = [...new Set(references)].sort();
  const parts: string[] = [];
  for (const path of paths) {
    const file = pack.files.get(path);
    if (!file) throw new Error(`模型缺少声明的资源 ${path}，无法计算模型身份。`);
    parts.push(`${path}\u0000${await sha256Hex(await file.bytes())}`);
  }
  if (!parts.length) throw new Error('模型没有可计算身份的资源。');
  return `live2d:${await sha256Hex(new TextEncoder().encode(parts.join('\n')))}`;
}
