import type { Live2DCapabilities, Live2DParameterCapability } from '../contracts';
import { parameterLabel } from './parameters';
import type { Live2DManifest } from './manifest';

export interface Live2DInspectionInput {
  name: string;
  drawableCount: number;
  mocVersion: number;
  textureCount: number;
  /** `[id, min, max, default]` read straight from the loaded model. */
  parameters: [string, number, number, number][];
  manifest: Pick<Live2DManifest, 'groups' | 'physics' | 'pose' | 'expressions'>;
}

/** Capability detection reads the model itself; well-known ids only supply labels. */
export function inspectLive2DModel(input: Live2DInspectionInput): Live2DCapabilities {
  const groupOf = new Map<string, string>();
  const groups: Record<string, number> = {};
  for (const group of input.manifest.groups) {
    groups[group.name] = (groups[group.name] ?? 0) + group.ids.length;
    for (const id of group.ids) if (!groupOf.has(id)) groupOf.set(id, group.name);
  }
  const parameters: Live2DParameterCapability[] = input.parameters.map(([id, min, max, value]) => ({
    id, label: parameterLabel(id), group: groupOf.get(id) ?? '',
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
    default: Number.isFinite(value) ? value : 0,
  }));
  const ids = new Set(parameters.map((parameter) => parameter.id));
  const has = (...candidates: string[]) => candidates.some((id) => ids.has(id));
  const angle = has('ParamAngleX') && has('ParamAngleY') && has('ParamAngleZ');
  const eyeLeft = has('ParamEyeLOpen'), eyeRight = has('ParamEyeROpen');
  const mouth = has('ParamMouthOpenY');
  const smile = has('ParamMouthForm', 'ParamMouthSmile');
  const brows = has('ParamBrowLY', 'ParamBrowLForm') && has('ParamBrowRY', 'ParamBrowRForm');
  const gaze = has('ParamEyeBallX') && has('ParamEyeBallY');
  const missing = [
    ...(!angle ? ['缺少头部角度参数（ParamAngleX / Y / Z），头部转动无法驱动'] : []),
    ...(!eyeLeft || !eyeRight ? ['缺少左右眼开合参数（ParamEyeLOpen / ParamEyeROpen）'] : []),
    ...(!mouth ? ['缺少嘴部开合参数（ParamMouthOpenY）'] : []),
    ...(!smile ? ['模型没有嘴型参数，微笑不可用'] : []),
    ...(!brows ? ['模型没有眉毛参数，眉毛不可用'] : []),
    ...(!gaze ? ['模型没有视线参数（ParamEyeBallX / Y），视线不可用'] : []),
  ];
  return {
    format: 'live2d', name: input.name,
    parameters, groups,
    expressionNames: input.manifest.expressions.map((expression) => expression.name),
    hasPhysics: Boolean(input.manifest.physics), hasPose: Boolean(input.manifest.pose),
    textureCount: input.textureCount, drawableCount: input.drawableCount, mocVersion: input.mocVersion,
    missing,
    level: angle && eyeLeft && eyeRight && mouth ? (smile && brows ? 'rich' : 'face') : 'basic',
  };
}
