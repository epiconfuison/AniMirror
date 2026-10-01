import type { Rotation, TrackingFrame, UserCalibration } from '../contracts';
import { INPUT_CHANNELS } from './channels';

export type CalibrationStep = 'neutral' | 'blink' | 'mouth' | 'smile' | 'brow';
export type CalibrationResult = { ok: true; calibration: UserCalibration } | { ok: false; error: string };
export const CALIBRATION_STEPS: { id: CalibrationStep; label: string; instruction: string; optional: boolean }[] = [
  { id: 'neutral', label: '中性脸', instruction: '正面看向摄像头，放松面部并保持自然表情。', optional: false },
  { id: 'blink', label: '闭眼', instruction: '轻轻闭合双眼并保持一小会儿。', optional: false },
  { id: 'mouth', label: '张嘴', instruction: '自然张嘴并保持，避免转头。', optional: false },
  { id: 'smile', label: '微笑', instruction: '自然微笑并保持，让两侧嘴角抬起。', optional: false },
  { id: 'brow', label: '抬眉（可选）', instruction: '抬起眉毛并保持；模型不支持时可以跳过。', optional: true },
];
const actionChannels: Record<Exclude<CalibrationStep, 'neutral'>, string[]> = {
  blink: ['eyeBlinkLeft', 'eyeBlinkRight'], mouth: ['jawOpen'],
  smile: ['mouthSmileLeft', 'mouthSmileRight'], brow: ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'],
};
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
};
const copy = <T>(value: T): T => structuredClone(value);

export class CalibrationCollector {
  private step: CalibrationStep = 'neutral';
  private samples: TrackingFrame[] = [];
  private lastTimestamp = -Infinity;
  private calibration: UserCalibration | undefined;
  readonly minSamples = 15;

  constructor(initial?: UserCalibration) { this.calibration = initial ? copy(initial) : undefined; }
  start(step: CalibrationStep): void { this.step = step; this.samples = []; this.lastTimestamp = -Infinity; }
  get sampleCount(): number { return this.samples.length; }
  getCalibration(): UserCalibration | undefined { return this.calibration ? copy(this.calibration) : undefined; }
  add(frame: TrackingFrame): number {
    const required = this.step === 'neutral' ? ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight'] : actionChannels[this.step];
    const valid = frame.schemaVersion === 1 && frame.faceDetected && Number.isFinite(frame.timestamp)
      && frame.timestamp > this.lastTimestamp && Object.values(frame.rotation).every((value) => Number.isFinite(value) && Math.abs(value) <= Math.PI)
      && required.every((name) => Number.isFinite(frame.channels[name]) && frame.channels[name]! >= 0 && frame.channels[name]! <= 1);
    if (!valid || this.samples.length >= 300) return this.sampleCount;
    this.lastTimestamp = frame.timestamp;
    this.samples.push(copy(frame));
    return this.sampleCount;
  }
  finish(): CalibrationResult {
    if (this.sampleCount < this.minSamples) return { ok: false, error: `有效人脸样本不足：${this.sampleCount}/${this.minSamples}，请保持动作后重试。` };
    const values = (name: string) => this.samples.map((frame) => frame.channels[name]).filter((value): value is number => Number.isFinite(value));
    if (this.step === 'neutral') {
      if (['x', 'y', 'z'].some((axis) => {
        const angles = this.samples.map((frame) => frame.rotation[axis as keyof Rotation]);
        return quantile(angles, 0.9) - quantile(angles, 0.1) > 0.2;
      })) return { ok: false, error: '中性脸采样时头部移动过多，请保持正面并重试。' };
      if (quantile(values('jawOpen'), 0.5) > 0.35 || ['eyeBlinkLeft', 'eyeBlinkRight'].some((name) => quantile(values(name), 0.5) > 0.5)) {
        return { ok: false, error: '中性脸应自然睁眼并放松闭嘴，请重试。' };
      }
      const neutral = Object.fromEntries(INPUT_CHANNELS.filter(({ name }) => values(name).length > 0).map(({ name }) => [name, quantile(values(name), 0.5)]));
      this.calibration = { schemaVersion: 1, profileId: 'default', createdAt: new Date().toISOString(), neutral,
        ranges: {}, neutralRotation: { x: quantile(this.samples.map((f) => f.rotation.x), 0.5), y: quantile(this.samples.map((f) => f.rotation.y), 0.5), z: quantile(this.samples.map((f) => f.rotation.z), 0.5) },
        quality: { neutral: Math.min(1, this.sampleCount / 30) } };
    } else {
      if (!this.calibration) return { ok: false, error: '请先完成中性脸校准。' };
      const threshold = this.step === 'brow' ? 0.08 : this.step === 'smile' ? 0.1 : 0.15;
      const ranges = Object.fromEntries(actionChannels[this.step].map((name) => [name, quantile(values(name), 0.8) - (this.calibration!.neutral[name] ?? 0)]));
      const validRanges = Object.values(ranges).filter((range) => range >= threshold);
      if ((this.step === 'brow' && !validRanges.length) || (this.step !== 'brow' && validRanges.length !== Object.keys(ranges).length)) {
        return { ok: false, error: '动作幅度不足，无法与中性脸区分；请保持更清晰的动作后重试。' };
      }
      for (const [name, range] of Object.entries(ranges)) if (range >= threshold) this.calibration.ranges[name] = range;
      this.calibration.quality[this.step] = Math.min(1, Math.min(...validRanges) / (threshold * 2)) * Math.min(1, this.sampleCount / 30);
      this.calibration.createdAt = new Date().toISOString();
    }
    return { ok: true, calibration: copy(this.calibration!) };
  }
}
