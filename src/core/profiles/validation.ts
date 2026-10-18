import type { ChannelTuning, ConfigBundle, MappingRule, ModelCapabilities, ModelFormat, ModelProfile, Rotation, UISettings, UserCalibration } from '../contracts';
import { PROFILE_SCHEMA_VERSION } from '../contracts';
import { INPUT_NAMES } from '../retargeting/channels';
import { driveTargets } from '../adapters/capabilities';

type JsonObject = Record<string, unknown>;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (message: string): never => { throw new Error(`配置无效：${message}`); };
function object(value: unknown, name: string, keys?: string[]): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(`${name} 应为对象`);
  const result = value as JsonObject;
  if (Object.keys(result).some((key) => forbidden.has(key) || (keys && !keys.includes(key)))) return fail(`${name} 包含未知字段`);
  return result;
}
function string(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || forbidden.has(value)) return fail(`${name} 应为有效文本`);
  return value;
}
function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${name} 必须是有限数值`);
  return Math.max(min, Math.min(max, value));
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') return fail(`${name} 应为布尔值`);
  return value;
}
function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  return boolean(value, name);
}
function enumeration<T extends string>(value: unknown, name: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return fail(`${name} 不受支持`);
  return value as T;
}
/** Version 1 profiles predate the format discriminator; they are migrated in place. */
function profileVersion(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) fail('不支持此 schemaVersion；当前支持版本 1（迁移）与 2');
  return value as 1 | 2;
}
function version1(value: unknown): void { if (value !== 1) fail('不支持此 schemaVersion；该结构仅支持版本 1'); }
function rotation(value: unknown, name: string, min: number, max: number): Rotation {
  const source = object(value, name, ['x', 'y', 'z']);
  return { x: number(source.x, `${name}.x`, min, max), y: number(source.y, `${name}.y`, min, max), z: number(source.z, `${name}.z`, min, max) };
}
function channelNumbers(value: unknown, name: string, min: number, max: number, names: ReadonlySet<string> = INPUT_NAMES): Record<string, number> {
  const source = object(value, name);
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => {
    if (!names.has(key)) return fail(`${name} 包含未知通道 ${key}`);
    return [key, number(entry, `${name}.${key}`, min, max)];
  }));
}
function tuning(value: unknown, name: string): ChannelTuning {
  const source = object(value, name, ['gain', 'deadZone', 'min', 'max', 'curve']);
  const min = number(source.min, `${name}.min`, 0, 1), max = number(source.max, `${name}.max`, 0, 1);
  if (min > max) return fail(`${name} 下限大于上限`);
  return { gain: number(source.gain, `${name}.gain`, 0, 3), deadZone: number(source.deadZone, `${name}.deadZone`, 0, 0.95), min, max, curve: number(source.curve, `${name}.curve`, 0.1, 4) };
}

const PROFILE_KEYS = ['schemaVersion', 'modelHash', 'modelName', 'format', 'mappings', 'tuning', 'headLimits', 'headGain', 'smoothing', 'style', 'eyeMode'];

export function validateModelProfile(value: unknown, modelHash?: string, capabilities?: ModelCapabilities): ModelProfile {
  const source = object(value, 'model', PROFILE_KEYS);
  const version = profileVersion(source.schemaVersion);
  const hash = string(source.modelHash, 'modelHash', 128);
  if (modelHash !== undefined && hash !== modelHash) return fail('模型文件哈希不匹配，请选择导出配置时使用的同一模型');
  // Version 1 always described a VRM; a missing format is migrated, never guessed for v2.
  const format: ModelFormat = version === 1 ? 'vrm' : enumeration(source.format, 'format', ['vrm', 'live2d'] as const);
  if (capabilities && capabilities.format !== format) return fail(`配置属于 ${format} 模型，与当前 ${capabilities.format} 模型不匹配`);
  if (!Array.isArray(source.mappings) || source.mappings.length > 2048) return fail('mappings 应为最多 2048 项的数组');
  const targets = capabilities ? new Set(driveTargets(capabilities).map((target) => target.id)) : undefined;
  const ids = new Set<string>();
  const mappings = source.mappings.map((entry, index): MappingRule => {
    const rule = object(entry, `mappings[${index}]`, ['id', 'input', 'target', 'weight', 'enabled', 'approximate', 'confirmed', 'signed', 'invert']);
    const id = string(rule.id, '映射 id', 300), input = string(rule.input, '输入通道'), target = string(rule.target, '目标', 120);
    if (ids.has(id)) return fail(`映射 id 重复：${id}`);
    ids.add(id);
    if (!INPUT_NAMES.has(input)) return fail(`未知输入通道 ${input}`);
    if (targets && !targets.has(target)) return fail(`当前模型没有可驱动目标 ${target}`);
    const migrated: MappingRule = { id, input, target, weight: number(rule.weight, '映射权重', -2, 2), enabled: boolean(rule.enabled, 'enabled'),
      approximate: boolean(rule.approximate, 'approximate'), confirmed: boolean(rule.confirmed, 'confirmed') };
    const signed = optionalBoolean(rule.signed, 'signed');
    const invert = optionalBoolean(rule.invert, 'invert');
    if (signed !== undefined) migrated.signed = signed;
    if (invert !== undefined) migrated.invert = invert;
    return migrated;
  });
  const tuningSource = object(source.tuning, 'tuning');
  const settings = Object.fromEntries(Object.entries(tuningSource).map(([key, entry]) => {
    if (!INPUT_NAMES.has(key)) return fail(`未知调节通道 ${key}`);
    return [key, tuning(entry, `tuning.${key}`)];
  }));
  return { schemaVersion: PROFILE_SCHEMA_VERSION, modelHash: hash, modelName: string(source.modelName, 'modelName'), format,
    mappings, tuning: settings,
    headLimits: rotation(source.headLimits, 'headLimits', 0, Math.PI / 2), headGain: number(source.headGain, 'headGain', 0, 3),
    smoothing: number(source.smoothing, 'smoothing', 0, 1), style: enumeration(source.style, 'style', ['natural', 'enhanced']),
    eyeMode: enumeration(source.eyeMode, 'eyeMode', ['expression', 'off']) };
}

export function validateCalibration(value: unknown): UserCalibration {
  const source = object(value, 'calibration', ['schemaVersion', 'profileId', 'createdAt', 'neutral', 'ranges', 'neutralRotation', 'quality']);
  version1(source.schemaVersion);
  const createdAt = string(source.createdAt, 'createdAt');
  if (!Number.isFinite(Date.parse(createdAt))) return fail('校准日期无效');
  return { schemaVersion: 1, profileId: string(source.profileId, 'profileId'), createdAt,
    neutral: channelNumbers(source.neutral, 'neutral', 0, 1), ranges: channelNumbers(source.ranges, 'ranges', 0.05, 1),
    neutralRotation: rotation(source.neutralRotation, 'neutralRotation', -Math.PI, Math.PI),
    quality: channelNumbers(source.quality, 'quality', 0, 1, new Set(['neutral', 'blink', 'mouth', 'smile', 'brow'])) };
}

export function validateUISettings(value: unknown): UISettings {
  const source = object(value, 'ui', ['schemaVersion', 'background', 'framing', 'mirror', 'showVideo']);
  version1(source.schemaVersion);
  if (typeof source.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(source.background)) return fail('背景色应为六位十六进制颜色');
  return { schemaVersion: 1, background: source.background, framing: enumeration(source.framing, 'framing', ['head', 'half']),
    mirror: boolean(source.mirror, 'mirror'), showVideo: boolean(source.showVideo, 'showVideo') };
}

export function validateBundle(value: unknown, modelHash?: string, capabilities?: ModelCapabilities): ConfigBundle {
  const source = object(value, '配置', ['schemaVersion', 'model', 'calibration', 'ui']);
  profileVersion(source.schemaVersion);
  const bundle: ConfigBundle = { schemaVersion: PROFILE_SCHEMA_VERSION };
  if (source.model !== undefined) bundle.model = validateModelProfile(source.model, modelHash, capabilities);
  if (source.calibration !== undefined) bundle.calibration = validateCalibration(source.calibration);
  if (source.ui !== undefined) bundle.ui = validateUISettings(source.ui);
  if (!bundle.model && !bundle.calibration && !bundle.ui) return fail('配置不包含模型、个人校准或界面设置');
  return bundle;
}

export function parseBundle(json: string, modelHash?: string, capabilities?: ModelCapabilities): ConfigBundle {
  if (json.length > 2 * 1024 * 1024) return fail('配置文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail('JSON 文件无法解析'); }
  return validateBundle(parsed, modelHash, capabilities);
}
export function serializeBundle(bundle: ConfigBundle): string { return JSON.stringify(validateBundle(bundle), null, 2); }
