import { basename, extensionOf, readPackJson, resolveReference, type Live2DPack } from './pack';

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(`模型描述文件无效：${message}`); };
const text = (value: unknown, name: string, max = 512): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail(`${name} 应是非空文本`);
  return value;
};
const array = (value: unknown, name: string, max: number): unknown[] => {
  if (!Array.isArray(value)) return fail(`${name} 应为数组`);
  if (value.length > max) return fail(`${name} 项数超过 ${max} 上限`);
  return value;
};
const numericRecord = (value: unknown, name: string, allowed: readonly string[]): Record<string, number> => {
  if (value === undefined) return {};
  if (!isObject(value)) return fail(`${name} 应为对象`);
  const entries = Object.entries(value);
  if (entries.length > 16) return fail(`${name} 项数过多`);
  const result: Record<string, number> = {};
  for (const [key, entry] of entries) {
    if (!allowed.includes(key)) return fail(`${name}.${key} 不是受支持的布局键`);
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return fail(`${name}.${key} 应为有限数值`);
    result[key] = entry;
  }
  return result;
};

export interface Live2DExpressionReference { name: string; path: string }
export interface Live2DManifest {
  version: 3;
  /** Resolved package paths (relative to the selected folder). */
  moc: string;
  textures: string[];
  physics?: string;
  pose?: string;
  userData?: string;
  motions: string[];
  expressions: Live2DExpressionReference[];
  layout: Record<string, number>;
  groups: { target: string; name: string; ids: string[] }[];
  hitAreas: { id: string; name: string }[];
  /** Every file the manifest really uses; the model identity hashes exactly this set. */
  references: string[];
}

const LAYOUT_KEYS = ['width', 'height', 'x', 'y', 'center_x', 'center_y', 'top', 'bottom', 'left', 'right'] as const;

/**
 * Reads and validates `*.model3.json`. Only version 3 manifests are accepted, every
 * referenced resource must live inside the package, and a `.moc3` entry is mandatory:
 * an arbitrary JSON file can never be mistaken for a model.
 */
export async function readManifest(pack: Live2DPack): Promise<Live2DManifest> {
  const raw = await readPackJson(pack, pack.entry);
  if (!isObject(raw)) return fail('顶层应为对象');
  if (raw.Version !== 3) return fail(`仅支持 Version 3 的 model3.json，当前为 ${String(raw.Version)}`);
  const references = isObject(raw.FileReferences) ? raw.FileReferences : fail('缺少 FileReferences');
  const mocReference = text(references.Moc, 'FileReferences.Moc');
  if (extensionOf(mocReference) !== 'moc3') return fail('FileReferences.Moc 必须指向 .moc3 文件');
  const moc = resolveReference(pack.entry, mocReference);
  if (!pack.files.has(moc)) return fail(`模型缺少 ${basename(moc)}`);
  const textures = array(references.Textures, 'FileReferences.Textures', 16).map((entry, index) => {
    const reference = text(entry, `FileReferences.Textures[${index}]`);
    const path = resolveReference(pack.entry, reference);
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(extensionOf(path))) return fail(`贴图 ${reference} 不是受支持的图片格式`);
    if (!pack.files.has(path)) return fail(`模型缺少贴图 ${reference}`);
    return path;
  });
  if (!textures.length) return fail('模型没有声明任何贴图');
  const optional = (value: unknown, name: string, extensions: string[]): string | undefined => {
    if (value === undefined || value === '') return undefined;
    const path = resolveReference(pack.entry, text(value, name));
    if (!extensions.includes(extensionOf(path))) return fail(`${name} 文件类型不受支持`);
    if (!pack.files.has(path)) return fail(`模型缺少 ${basename(path)}`);
    return path;
  };
  const physics = optional(references.Physics, 'FileReferences.Physics', ['json']);
  const pose = optional(references.Pose, 'FileReferences.Pose', ['json']);
  const userData = optional(references.UserData, 'FileReferences.UserData', ['json']);
  const expressions: Live2DExpressionReference[] = [];
  if (references.Expressions !== undefined) {
    array(references.Expressions, 'FileReferences.Expressions', 64).forEach((entry, index) => {
      if (!isObject(entry)) return fail(`FileReferences.Expressions[${index}] 应为对象`);
      const name = text(entry.Name, `Expressions[${index}].Name`, 120);
      const path = resolveReference(pack.entry, text(entry.File, `Expressions[${index}].File`));
      if (!pack.files.has(path)) return fail(`模型缺少表情文件 ${basename(path)}`);
      expressions.push({ name, path });
    });
  }
  const motions: string[] = [];
  if (references.Motions !== undefined) {
    if (!isObject(references.Motions)) return fail('FileReferences.Motions 应为对象');
    for (const [group, entries] of Object.entries(references.Motions)) {
      array(entries, `Motions.${group}`, 256).forEach((entry, index) => {
        if (!isObject(entry)) return fail(`Motions.${group}[${index}] 应为对象`);
        const path = resolveReference(pack.entry, text(entry.File, `Motions.${group}[${index}].File`));
        if (!pack.files.has(path)) return fail(`模型缺少动作文件 ${basename(path)}`);
        motions.push(path);
      });
    }
  }
  const groups: Live2DManifest['groups'] = [];
  if (raw.Groups !== undefined) {
    array(raw.Groups, 'Groups', 32).forEach((entry, index) => {
      if (!isObject(entry)) return fail(`Groups[${index}] 应为对象`);
      groups.push({
        target: text(entry.Target, `Groups[${index}].Target`, 60),
        name: text(entry.Name, `Groups[${index}].Name`, 60),
        ids: array(entry.Ids, `Groups[${index}].Ids`, 64).map((id, position) => text(id, `Groups[${index}].Ids[${position}]`, 120)),
      });
    });
  }
  const hitAreas: Live2DManifest['hitAreas'] = [];
  if (raw.HitAreas !== undefined) {
    array(raw.HitAreas, 'HitAreas', 64).forEach((entry, index) => {
      if (!isObject(entry)) return fail(`HitAreas[${index}] 应为对象`);
      hitAreas.push({ id: text(entry.Id, `HitAreas[${index}].Id`, 60), name: text(entry.Name, `HitAreas[${index}].Name`, 60) });
    });
  }
  const layout = numericRecord(raw.Layout, 'Layout', LAYOUT_KEYS);
  return { version: 3, moc, textures, physics, pose, userData, motions, expressions, layout, groups, hitAreas,
    references: [pack.entry, moc, ...textures, ...(physics ? [physics] : []), ...(pose ? [pose] : []),
      ...(userData ? [userData] : []), ...expressions.map((item) => item.path), ...motions] };
}
