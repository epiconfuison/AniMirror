import type { Live2DCapabilities, Live2DParameterCapability, MappingRule } from '../contracts';

/**
 * Well-known Cubism parameter ids. They are only a *hint* for labels and for suggested
 * mappings: a capability is enabled solely when the loaded model really exposes the id,
 * so a model with unusual naming simply reports the ability as missing.
 */
export interface KnownParameter { label: string; role: 'head-x' | 'head-y' | 'head-z' | 'eye-left' | 'eye-right' | 'look-x' | 'look-y' | 'mouth-open' | 'mouth-form' | 'brow-left' | 'brow-right' | 'eye-smile-left' | 'eye-smile-right' }
export const KNOWN_PARAMETERS: Record<string, KnownParameter> = {
  ParamAngleX: { label: '头部左右转动', role: 'head-x' },
  ParamAngleY: { label: '头部俯仰', role: 'head-y' },
  ParamAngleZ: { label: '头部倾斜', role: 'head-z' },
  ParamEyeLOpen: { label: '左眼开合', role: 'eye-left' },
  ParamEyeROpen: { label: '右眼开合', role: 'eye-right' },
  ParamEyeBallX: { label: '视线水平', role: 'look-x' },
  ParamEyeBallY: { label: '视线垂直', role: 'look-y' },
  ParamMouthOpenY: { label: '嘴部开合', role: 'mouth-open' },
  ParamMouthForm: { label: '嘴型（微笑）', role: 'mouth-form' },
  ParamBrowLY: { label: '左眉上下', role: 'brow-left' },
  ParamBrowRY: { label: '右眉上下', role: 'brow-right' },
  ParamBrowLForm: { label: '左眉形状', role: 'brow-left' },
  ParamBrowRForm: { label: '右眉形状', role: 'brow-right' },
  ParamEyeLSmile: { label: '左眼笑', role: 'eye-smile-left' },
  ParamEyeRSmile: { label: '右眼笑', role: 'eye-smile-right' },
};

export const parameterLabel = (id: string): string => KNOWN_PARAMETERS[id]?.label ?? id;

/**
 * Cubism head parameters are degrees, while the tracking contract is radians with
 * `x` = pitch, `y` = yaw and `z` = roll. `ParamAngleX` is the yaw axis, `ParamAngleY`
 * the pitch axis and `ParamAngleZ` the roll axis; the signs were confirmed against the
 * rendered model (see progress/06-live2d) so a turn to the viewer's right stays a turn
 * to the viewer's right in both formats.
 */
export const HEAD_AXIS_SIGN = { yaw: 1, pitch: 1, roll: 1 } as const;

export function headParameterValues(rotation: { x: number; y: number; z: number }): Record<string, number> {
  const degrees = (radians: number): number => (Number.isFinite(radians) ? radians * 180 / Math.PI : 0);
  return {
    ParamAngleX: HEAD_AXIS_SIGN.yaw * degrees(rotation.y),
    ParamAngleY: HEAD_AXIS_SIGN.pitch * degrees(rotation.x),
    ParamAngleZ: HEAD_AXIS_SIGN.roll * degrees(rotation.z),
  };
}

/**
 * Amount semantics are shared by every adapter: a drive amount is a normalised offset
 * from the parameter's neutral value, and `signed` targets also accept negative offsets.
 *
 * - bipolar parameter (min < default < max): amount 0 is neutral, ±1 reaches the limit
 * - unipolar parameter (default sits on a limit): amount is the normalised position
 */
export function parameterValue(parameter: Pick<Live2DParameterCapability, 'min' | 'max' | 'default'>, amount: number): number {
  const { min, max, default: neutral } = parameter;
  const value = Number.isFinite(amount) ? amount : 0;
  if (neutral > min && neutral < max) {
    const span = value >= 0 ? max - neutral : neutral - min;
    return Math.min(max, Math.max(min, neutral + value * span));
  }
  return min + Math.min(1, Math.max(0, value)) * (max - min);
}

const unconfirmed = { approximate: true, confirmed: false } as const;
const confident = { approximate: false, confirmed: true } as const;
/** Suggested mappings for a Live2D model, limited to the parameters it actually exposes. */
export function suggestLive2DMappings(capabilities: Live2DCapabilities): MappingRule[] {
  const available = new Set(capabilities.parameters.map((parameter) => parameter.id));
  const rules: MappingRule[] = [];
  const add = (input: string, target: string, weight: number, extra: Partial<MappingRule> = {}) => {
    if (!available.has(target)) return;
    rules.push({ id: `${input}:${target}`, input, target, weight, enabled: true, ...confident, ...extra });
  };
  // Eyes close as the channel rises, while Cubism stores openness.
  add('eyeBlinkLeft', 'ParamEyeLOpen', 1, { invert: true });
  add('eyeBlinkRight', 'ParamEyeROpen', 1, { invert: true });
  add('jawOpen', 'ParamMouthOpenY', 1);
  // Both mouth corners share one shape parameter, so each contributes half a smile.
  add('mouthSmileLeft', 'ParamMouthForm', 0.6);
  add('mouthSmileRight', 'ParamMouthForm', 0.6);
  add('browOuterUpLeft', 'ParamBrowLY', 1);
  add('browOuterUpRight', 'ParamBrowRY', 1);
  add('browInnerUp', 'ParamBrowLY', 0.5);
  add('browInnerUp', 'ParamBrowRY', 0.5);
  add('eyeSquintLeft', 'ParamEyeLSmile', 1);
  add('eyeSquintRight', 'ParamEyeRSmile', 1);
  // Gaze direction differs between models; these stay unconfirmed until a manual test.
  const gaze: [string, string, number][] = [
    ['eyeLookInLeft', 'ParamEyeBallX', 1], ['eyeLookOutLeft', 'ParamEyeBallX', -1],
    ['eyeLookInRight', 'ParamEyeBallX', -1], ['eyeLookOutRight', 'ParamEyeBallX', 1],
    ['eyeLookUpLeft', 'ParamEyeBallY', 1], ['eyeLookUpRight', 'ParamEyeBallY', 1],
    ['eyeLookDownLeft', 'ParamEyeBallY', -1], ['eyeLookDownRight', 'ParamEyeBallY', -1],
  ];
  for (const [input, target, weight] of gaze) add(input, target, weight, { signed: true, ...unconfirmed });
  return rules;
}
