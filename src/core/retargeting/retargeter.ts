import { DEFAULT_TUNING } from '../contracts';
import type { ChannelTuning, DriveOutput, ModelProfile, Rotation, TrackingFrame, UserCalibration } from '../contracts';
import { INPUT_CHANNELS } from './channels';

export const TRACKING_TIMING = { staleMs: 200, holdMs: 250, fadeMs: 550, recoveryMs: 180 } as const;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isNaN(value) ? 0 : value));
const zero = (): Rotation => ({ x: 0, y: 0, z: 0 });
const axes = ['x', 'y', 'z'] as const;

/** Calibration describes the person; model tuning is deliberately applied afterwards. */
export function normalizeChannel(input: string, value: number, calibration?: UserCalibration): number {
  const baseline = calibration?.neutral[input] ?? 0;
  const range = Math.max(0.05, calibration?.ranges[input] ?? (1 - baseline));
  return clamp((value - baseline) / range);
}

export function tuneChannel(value: number, tuning: ChannelTuning = DEFAULT_TUNING, enhanced = false): number {
  const deadZone = clamp(tuning.deadZone, 0, 0.95);
  const active = clamp((value - deadZone) / (1 - deadZone));
  const curved = Math.pow(active, clamp(tuning.curve, 0.1, 4));
  const min = clamp(tuning.min), max = Math.max(min, clamp(tuning.max));
  return clamp(curved * clamp(tuning.gain, 0, 3) * (enhanced ? 1.25 : 1), min, max);
}

function filtered(previous: number, target: number, dt: number, smoothing: number, fast: boolean): number {
  if (smoothing <= 0) return target;
  const change = Math.abs(target - previous);
  let tau = (12 + clamp(smoothing) * 170) / (1 + change * 10);
  if (fast && change > 0.12) tau = Math.min(tau, 12);
  return previous + (target - previous) * (1 - Math.exp(-dt / tau));
}

/** One compositor owns each target. Manual tests override its output without contaminating tracking state. */
export class Retargeter {
  private lastNow: number | undefined;
  private lastTimestamp = -Infinity;
  private lastSeen = -Infinity;
  private facePresent = false;
  private latest?: TrackingFrame;
  private channels: Record<string, number> = {};
  private rotation = zero();
  private output: DriveOutput = { expressions: {}, rotation: zero(), tracking: 'lost' };
  private held: DriveOutput = { expressions: {}, rotation: zero(), tracking: 'lost' };
  private recoveryStart = -Infinity;
  private recoveryFrom: DriveOutput = { expressions: {}, rotation: zero(), tracking: 'lost' };
  private hasTracked = false;

  reset(): void {
    this.lastNow = undefined; this.lastTimestamp = this.lastSeen = -Infinity; this.facePresent = false;
    this.latest = undefined; this.channels = {}; this.rotation = zero(); this.hasTracked = false;
    this.output = { expressions: {}, rotation: zero(), tracking: 'lost' };
    this.held = structuredClone(this.output); this.recoveryFrom = structuredClone(this.output); this.recoveryStart = -Infinity;
  }

  update(frame: TrackingFrame | null, profile: ModelProfile, calibration: UserCalibration | undefined, nowMs: number, manualOverrides: Record<string, number> = {}): DriveOutput {
    const now = Number.isFinite(nowMs) ? Math.max(nowMs, this.lastNow ?? nowMs) : (this.lastNow ?? 0);
    const dt = this.lastNow === undefined ? 16.667 : clamp(now - this.lastNow, 0, 250);
    this.lastNow = now;
    if (frame && frame.schemaVersion === 1 && Number.isFinite(frame.timestamp)
      && frame.timestamp > this.lastTimestamp && frame.timestamp <= now + 50 && now - frame.timestamp <= TRACKING_TIMING.staleMs
      && axes.every((axis) => Number.isFinite(frame.rotation[axis]) && Math.abs(frame.rotation[axis]) <= Math.PI)
      && Object.values(frame.channels).every(Number.isFinite)) {
      this.lastTimestamp = frame.timestamp;
      this.facePresent = frame.faceDetected;
      if (frame.faceDetected) { this.latest = frame; this.lastSeen = frame.timestamp; }
    }
    const age = now - this.lastSeen;
    const tracking: DriveOutput['tracking'] = this.facePresent && age <= TRACKING_TIMING.staleMs ? 'live' : age <= TRACKING_TIMING.holdMs ? 'hold' : 'lost';
    // Retain old target keys with zero values so removing/redirecting a mapping clears its previous expression.
    const expressions: Record<string, number> = Object.fromEntries([...Object.keys(this.output.expressions), ...profile.mappings.map((rule) => rule.target)].map((name) => [name, 0]));
    let rotation = zero();
    if (tracking === 'live' && this.latest) {
      if (this.output.tracking !== 'live' && this.hasTracked) {
        this.recoveryStart = now; this.recoveryFrom = structuredClone(this.output);
      }
      this.hasTracked = true;
      for (const { name } of INPUT_CHANNELS) {
        const normalized = normalizeChannel(name, this.latest.channels[name] ?? 0, calibration);
        const tuned = tuneChannel(normalized, profile.tuning[name] ?? DEFAULT_TUNING, profile.style === 'enhanced');
        this.channels[name] = filtered(this.channels[name] ?? 0, tuned, dt, profile.smoothing, name.startsWith('eyeBlink') || name === 'jawOpen');
      }
      for (const rule of profile.mappings) {
        if (!rule.enabled || (rule.approximate && !rule.confirmed) || (profile.eyeMode === 'off' && rule.input.startsWith('eyeLook'))) continue;
        expressions[rule.target] = (expressions[rule.target] ?? 0) + (this.channels[rule.input] ?? 0) * clamp(rule.weight, -2, 2);
      }
      for (const name of Object.keys(expressions)) expressions[name] = clamp(expressions[name]!);
      for (const axis of axes) {
        const limit = clamp(profile.headLimits[axis], 0, Math.PI / 2);
        const difference = this.latest.rotation[axis] - (calibration?.neutralRotation[axis] ?? 0);
        const wrapped = Math.atan2(Math.sin(difference), Math.cos(difference));
        const target = clamp(wrapped * clamp(profile.headGain, 0, 3), -limit, limit);
        this.rotation[axis] = filtered(this.rotation[axis], target, dt, profile.smoothing, false);
        rotation[axis] = this.rotation[axis];
      }
      const recover = clamp((now - this.recoveryStart) / TRACKING_TIMING.recoveryMs);
      if (recover < 1) {
        for (const name of Object.keys(expressions)) expressions[name] = (this.recoveryFrom.expressions[name] ?? 0) * (1 - recover) + expressions[name]! * recover;
        for (const axis of axes) rotation[axis] = this.recoveryFrom.rotation[axis] * (1 - recover) + rotation[axis] * recover;
      }
    } else {
      if (this.output.tracking === 'live') this.held = structuredClone(this.output);
      const amount = 1 - clamp((age - TRACKING_TIMING.holdMs) / TRACKING_TIMING.fadeMs);
      for (const name of Object.keys(expressions)) expressions[name] = (this.held.expressions[name] ?? 0) * amount;
      rotation = { x: this.held.rotation.x * amount, y: this.held.rotation.y * amount, z: this.held.rotation.z * amount };
      this.rotation = { ...rotation };
    }
    this.output = { expressions, rotation, tracking };
    const result = structuredClone(this.output);
    for (const [name, value] of Object.entries(manualOverrides)) if (Number.isFinite(value)) result.expressions[name] = clamp(value);
    return result;
  }
}
