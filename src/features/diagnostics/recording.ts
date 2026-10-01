import type { DriveOutput, ModelProfile, TrackingFrame, UserCalibration } from '../../core/contracts';
import { INPUT_NAMES, Retargeter } from '../../core/retargeting';
export interface ParameterRecording { schemaVersion: 1; durationMs: number; frames: TrackingFrame[] }
export interface RecordingBuffer { start: number; frames: TrackingFrame[] }
/** Capture-time timestamps and deep copies keep exports independent of inference arrival time or mutable caller data. */
export function appendRecordingFrame(recording: RecordingBuffer, frame: TrackingFrame): boolean {
  const timestamp = frame.timestamp - recording.start;
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 30000 || recording.frames.length >= 1000
    || timestamp <= (recording.frames.at(-1)?.timestamp ?? -1)) return false;
  recording.frames.push({ ...structuredClone(frame), timestamp });
  return true;
}
const hasOnly = (value: unknown, keys: string[]): boolean => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
export function parseRecording(json: string): ParameterRecording {
  if (json.length > 8_000_000) throw new Error('参数文件超过 8 MB。');
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('参数录制 JSON 无法解析。'); }
  if (!hasOnly(value, ['schemaVersion', 'durationMs', 'frames']) || value.schemaVersion !== 1 || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 30000 || !Array.isArray(value.frames) || !value.frames.length || value.frames.length > 1000) throw new Error('参数录制格式或时长无效。');
  let previous = -1;
  for (const frame of value.frames) {
    if (!hasOnly(frame, ['schemaVersion', 'timestamp', 'faceDetected', 'inferenceMs', 'rotation', 'channels']) || frame.schemaVersion !== 1 || !Number.isFinite(frame.timestamp) || frame.timestamp <= previous || frame.timestamp < 0 || frame.timestamp > value.durationMs || typeof frame.faceDetected !== 'boolean' || !Number.isFinite(frame.inferenceMs) || frame.inferenceMs < 0 || !hasOnly(frame.rotation, ['x','y','z']) || !['x','y','z'].every(k => Number.isFinite(frame.rotation[k]) && Math.abs(frame.rotation[k]) <= Math.PI) || !hasOnly(frame.channels, [...INPUT_NAMES]) || !Object.values(frame.channels).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('参数帧无效或时间戳未递增。');
    previous = frame.timestamp;
  }
  return value;
}
/** Fixed 60 Hz virtual clock: independent of browser RAF timing and machine speed. */
export function evaluateRecording(recording: ParameterRecording, profile: ModelProfile, calibration?: UserCalibration): DriveOutput[] {
  const engine = new Retargeter(), outputs: DriveOutput[] = [];
  let index = 0, latest: TrackingFrame | null = null;
  for (let tick = 0; tick <= Math.ceil(recording.durationMs * 60 / 1000); tick++) {
    const now = tick * 1000 / 60;
    while (index < recording.frames.length && recording.frames[index]!.timestamp <= now) latest = recording.frames[index++]!;
    outputs.push(engine.update(latest, profile, calibration, now));
  }
  return outputs;
}
