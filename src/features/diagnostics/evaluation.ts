import type { DriveOutput, ModelProfile, UserCalibration } from '../../core/contracts';
import { evaluateRecording, type ParameterRecording } from './recording';

export function jitterRms(values: number[]): number {
  if (!values.length || !values.every(Number.isFinite)) throw new Error('RMS 需要非空的有限数值样本。');
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
export function reductionPercent(baseline: number, selected: number): number | null {
  return baseline < 1e-8 ? null : (1 - selected / baseline) * 100;
}

/** Offline comparison, with a shared clock/window and matching live samples.
 * Values are compositor outputs before VRM expression override/binary rules.
 * This does not measure rendering, gesture accuracy or camera-to-screen delay.
 */
export function compareRecording(recording: ParameterRecording, profile: ModelProfile, calibration?: UserCalibration, startMs = 1000, endMs = recording.durationMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs > recording.durationMs || startMs >= endMs) throw new Error('分析时间范围无效；起点须早于终点且位于录制范围内。');
  const baseline = evaluateRecording(recording, { ...structuredClone(profile), smoothing: 0 }, calibration);
  const selected = evaluateRecording(recording, profile, calibration);
  const indices = selected.map((value, index) => ({ value, index, time: index * 1000 / 60 })).filter(({ time }) => time >= startMs && time <= endMs);
  const live = indices.filter(({ value, index }) => value.tracking === 'live' && baseline[index]!.tracking === 'live').map(({ index }) => index);
  if (live.length < 2) throw new Error('分析范围内有效人脸样本不足，不能计算静止抖动。');
  const metric = (pick: (output: DriveOutput) => number) => {
    const before = jitterRms(live.map(index => pick(baseline[index]!)));
    const after = jitterRms(live.map(index => pick(selected[index]!)));
    return { baselineRms: before, selectedRms: after, reductionPercent: reductionPercent(before, after) };
  };
  const head = Object.fromEntries((['x','y','z'] as const).map(axis => [axis, metric(output => output.rotation[axis])]));
  const before = Math.hypot(...Object.values(head).map(value => value.baselineRms));
  const after = Math.hypot(...Object.values(head).map(value => value.selectedRms));
  const targets = [...new Set(profile.mappings.filter(rule => rule.enabled && (!rule.approximate || rule.confirmed)).map(rule => rule.target))];
  const expressions = Object.fromEntries(targets.map(target => [target, metric(output => output.expressions[target] ?? 0)]));
  return { baseline, selected, summary: {
    schemaVersion: 1, modelHash: profile.modelHash, selectedSmoothing: profile.smoothing,
    windowMs: { start: startMs, end: endMs }, validSamples: live.length, excludedNonLiveSamples: indices.length - live.length,
    headUnit: 'radian', expressionUnit: 'normalized weight', head,
    headCombined: { baselineRms: before, selectedRms: after, reductionPercent: reductionPercent(before, after) },
    expressions,
    interpretation: 'Only valid for a genuinely stationary clip. Natural blinks and deliberate gestures are not jitter. Null reduction means the baseline has no measurable jitter. Fixed 60 Hz offline output before VRM overrides; not measured real-world latency or gesture success.',
  } };
}
