import { DEFAULT_TUNING } from '../contracts';
import type { AvatarCapabilities, MappingRule, ModelProfile } from '../contracts';

/** MediaPipe category names, never positional ARKit indices. */
export const INPUT_CHANNELS = [
  ['eyeBlinkLeft', '左眼闭合'], ['eyeBlinkRight', '右眼闭合'], ['jawOpen', '张嘴'],
  ['mouthSmileLeft', '左嘴角微笑'], ['mouthSmileRight', '右嘴角微笑'],
  ['browInnerUp', '眉心抬起'], ['browOuterUpLeft', '左眉抬起'], ['browOuterUpRight', '右眉抬起'],
  ['browDownLeft', '左眉下压'], ['browDownRight', '右眉下压'],
  ['eyeLookUpLeft', '左眼向上'], ['eyeLookUpRight', '右眼向上'],
  ['eyeLookDownLeft', '左眼向下'], ['eyeLookDownRight', '右眼向下'],
  ['eyeLookInLeft', '左眼向内'], ['eyeLookInRight', '右眼向内'],
  ['eyeLookOutLeft', '左眼向外'], ['eyeLookOutRight', '右眼向外'],
  ['eyeSquintLeft', '左眼眯起'], ['eyeSquintRight', '右眼眯起'],
  ['eyeWideLeft', '左眼睁大'], ['eyeWideRight', '右眼睁大'],
  ['cheekPuff', '鼓腮'], ['cheekSquintLeft', '左脸颊抬起'], ['cheekSquintRight', '右脸颊抬起'],
  ['jawForward', '下颌前伸'], ['jawLeft', '下颌向左'], ['jawRight', '下颌向右'],
  ['mouthClose', '嘴唇闭合'], ['mouthFunnel', '圆口'], ['mouthPucker', '噘嘴'],
  ['mouthLeft', '嘴向左'], ['mouthRight', '嘴向右'],
  ['mouthDimpleLeft', '左嘴角收紧'], ['mouthDimpleRight', '右嘴角收紧'],
  ['mouthFrownLeft', '左嘴角下垂'], ['mouthFrownRight', '右嘴角下垂'],
  ['mouthLowerDownLeft', '左下唇下降'], ['mouthLowerDownRight', '右下唇下降'],
  ['mouthUpperUpLeft', '左上唇抬起'], ['mouthUpperUpRight', '右上唇抬起'],
  ['mouthPressLeft', '左侧抿嘴'], ['mouthPressRight', '右侧抿嘴'],
  ['mouthRollLower', '下唇内卷'], ['mouthRollUpper', '上唇内卷'],
  ['mouthShrugLower', '下唇抬起'], ['mouthShrugUpper', '上唇抬起'],
  ['mouthStretchLeft', '左嘴角拉伸'], ['mouthStretchRight', '右嘴角拉伸'],
  ['noseSneerLeft', '左侧皱鼻'], ['noseSneerRight', '右侧皱鼻'],
].map(([name, label]) => ({ name: name!, label: label! }));

export const INPUT_NAMES = new Set(INPUT_CHANNELS.map((channel) => channel.name));
const normalized = (name: string) => name.toLowerCase().replace(/[\s_.-]/g, '');
const aliases: Record<string, string[]> = {
  eyeBlinkLeft: ['blinkLeft', 'blink_l', 'blinkL'],
  eyeBlinkRight: ['blinkRight', 'blink_r', 'blinkR'],
  jawOpen: ['aa', 'a', 'mouthOpen'],
};
const approximations: Record<string, { aliases: string[]; weight: number }> = {
  eyeBlinkLeft: { aliases: ['blink'], weight: 0.5 },
  eyeBlinkRight: { aliases: ['blink'], weight: 0.5 },
  mouthSmileLeft: { aliases: ['happy', 'joy', 'smile'], weight: 0.5 },
  mouthSmileRight: { aliases: ['happy', 'joy', 'smile'], weight: 0.5 },
  mouthFunnel: { aliases: ['oh', 'o'], weight: 1 },
  mouthPucker: { aliases: ['ou', 'u'], weight: 1 },
  eyeLookUpLeft: { aliases: ['lookUp'], weight: 0.5 },
  eyeLookUpRight: { aliases: ['lookUp'], weight: 0.5 },
  eyeLookDownLeft: { aliases: ['lookDown'], weight: 0.5 },
  eyeLookDownRight: { aliases: ['lookDown'], weight: 0.5 },
  eyeLookInLeft: { aliases: ['lookRight'], weight: 0.5 },
  eyeLookOutRight: { aliases: ['lookRight'], weight: 0.5 },
  eyeLookInRight: { aliases: ['lookLeft'], weight: 0.5 },
  eyeLookOutLeft: { aliases: ['lookLeft'], weight: 0.5 },
};

/** Uncertain whole-face presets are suggestions requiring explicit confirmation. */
export function suggestMappings(capabilities: AvatarCapabilities): MappingRule[] {
  const available = capabilities.expressions.filter((expression) => expression.bindCount > 0);
  return INPUT_CHANNELS.flatMap(({ name: input }) => {
    const exact = available.find((expression) => normalized(expression.name) === normalized(input));
    const alias = available.find((expression) => aliases[input]?.some((name) => normalized(expression.name) === normalized(name)));
    const fallback = approximations[input];
    const approximate = available.find((expression) => fallback?.aliases.some((name) => normalized(expression.name) === normalized(name)));
    const target = exact ?? alias ?? approximate;
    if (!target) return [];
    const needsConfirmation = !exact && !alias;
    return [{ id: `${input}:${target.name}`, input, target: target.name,
      weight: needsConfirmation ? fallback!.weight : 1, enabled: true,
      approximate: needsConfirmation, confirmed: !needsConfirmation }];
  });
}

export function createDefaultProfile(modelHash: string, modelName: string, capabilities: AvatarCapabilities): ModelProfile {
  return {
    schemaVersion: 1, modelHash, modelName, mappings: suggestMappings(capabilities),
    tuning: Object.fromEntries(INPUT_CHANNELS.map(({ name }) => [name, { ...DEFAULT_TUNING }])),
    headLimits: { x: Math.PI / 4, y: Math.PI / 3, z: Math.PI / 5 },
    headGain: 1, smoothing: 0.5, style: 'natural', eyeMode: 'expression',
  };
}
