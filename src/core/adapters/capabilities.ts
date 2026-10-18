import type { Live2DCapabilities, ModelCapabilities, VrmCapabilities } from '../contracts';

/**
 * Format-agnostic view over a loaded model. Retargeting, mapping validation and the
 * UI only ever consume drive targets, so a Cubism parameter id can be reused as a
 * target name without teaching the tracking layer anything about Cubism.
 */
export interface DriveTarget {
  id: string; label: string;
  kind: 'expression' | 'parameter';
  min: number; max: number;
  /** Accepts amounts in [-1, 1] instead of [0, 1]. */
  signed: boolean;
}

export function isVrmCapabilities(capabilities: ModelCapabilities): capabilities is VrmCapabilities {
  return capabilities.format === 'vrm';
}
export function isLive2DCapabilities(capabilities: ModelCapabilities): capabilities is Live2DCapabilities {
  return capabilities.format === 'live2d';
}

export function driveTargets(capabilities: ModelCapabilities): DriveTarget[] {
  if (capabilities.format === 'vrm') {
    return capabilities.expressions
      .filter((expression) => expression.bindCount > 0)
      .map((expression) => ({ id: expression.name, label: expression.name, kind: 'expression' as const, min: 0, max: 1, signed: false }));
  }
  return capabilities.parameters.map((parameter) => ({ id: parameter.id, label: parameter.label, kind: 'parameter' as const,
    min: parameter.min, max: parameter.max, signed: parameter.min < 0 }));
}

export function driveTargetNames(capabilities: ModelCapabilities): Set<string> {
  return new Set(driveTargets(capabilities).map((target) => target.id));
}

export interface CapabilitySummary {
  level: ModelCapabilities['level'];
  missing: string[];
  head: boolean;
  eyeLeft: boolean;
  eyeRight: boolean;
  mouth: boolean;
  smile: boolean;
  brows: boolean;
  gaze: boolean;
  targetCount: number;
}

const has = (parameters: Live2DCapabilities['parameters'], ...ids: string[]): boolean => ids.some((id) => parameters.some((parameter) => parameter.id === id));

/** Capability flags come from what the model really exposes, never from a hard-coded assumption. */
export function summarizeCapabilities(capabilities: ModelCapabilities): CapabilitySummary {
  if (capabilities.format === 'vrm') {
    const usable = capabilities.expressions.filter((expression) => expression.bindCount > 0)
      .map((expression) => expression.name.toLowerCase().replace(/[_ -]/g, ''));
    const known = (...names: string[]) => names.some((name) => usable.includes(name));
    return {
      level: capabilities.level, missing: capabilities.missing,
      head: capabilities.bones.head,
      eyeLeft: known('blinkleft', 'eyeblinkleft'), eyeRight: known('blinkright', 'eyeblinkright'),
      mouth: known('aa', 'a', 'jawopen', 'mouthopen'),
      smile: known('happy', 'joy', 'mouthsmileleft', 'mouthsmileright', 'smile'),
      brows: known('browinnerup', 'browouterupleft', 'browdownleft'),
      gaze: known('eyelookupleft', 'eyelookupleft', 'lookup'),
      targetCount: driveTargets(capabilities).length,
    };
  }
  const parameters = capabilities.parameters;
  return {
    level: capabilities.level, missing: capabilities.missing,
    head: has(parameters, 'ParamAngleX') && has(parameters, 'ParamAngleY') && has(parameters, 'ParamAngleZ'),
    eyeLeft: has(parameters, 'ParamEyeLOpen'), eyeRight: has(parameters, 'ParamEyeROpen'),
    mouth: has(parameters, 'ParamMouthOpenY'), smile: has(parameters, 'ParamMouthForm'),
    brows: has(parameters, 'ParamBrowLY', 'ParamBrowLForm') && has(parameters, 'ParamBrowRY', 'ParamBrowRForm'),
    gaze: has(parameters, 'ParamEyeBallX') && has(parameters, 'ParamEyeBallY'),
    targetCount: driveTargets(capabilities).length,
  };
}
