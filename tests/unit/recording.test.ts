import { describe, expect, it } from 'vitest';
import type { AvatarCapabilities, TrackingFrame } from '../../src/core/contracts';
import { createDefaultProfile } from '../../src/core/retargeting';
import { appendRecordingFrame, evaluateRecording, parseRecording, type ParameterRecording } from '../../src/features/diagnostics/recording';

const frame = (timestamp: number, value = 0.7, faceDetected = true): TrackingFrame => ({ schemaVersion: 1, timestamp, faceDetected,
  rotation: { x: 0.1, y: -0.2, z: 0 }, channels: { jawOpen: value }, inferenceMs: 12 });
const capabilities: AvatarCapabilities = { version: '1', name: 'fixture', bones: { head: true, leftEye: false, rightEye: false },
  expressions: [{ name: 'aa', preset: true, bindCount: 1, isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none' }],
  morphTargets: ['aa'], missing: [], level: 'face', vertexCount: 10 };
const recorded = (): ParameterRecording => ({ schemaVersion: 1, durationMs: 1200, frames: [frame(10), frame(40), frame(100, 0, false), frame(1100, 0.9)] });

describe('parameter recordings', () => {
  it('preserves capture timestamps and immutable samples, dropping old or excessive frames', () => {
    const buffer = { start: 1000, frames: [] as TrackingFrame[] }, sample = frame(1020);
    expect(appendRecordingFrame(buffer, sample)).toBe(true);
    sample.channels.jawOpen = 0; sample.rotation.y = 1;
    expect(buffer.frames[0]).toMatchObject({ timestamp: 20, channels: { jawOpen: 0.7 }, rotation: { y: -0.2 } });
    for (const timestamp of [1000, 1010, 1020, 999, 31001, NaN]) expect(appendRecordingFrame(buffer, frame(timestamp))).toBe(false);
    expect(appendRecordingFrame(buffer, frame(31000))).toBe(true);
    const full = { start: 0, frames: Array.from({ length: 1000 }, (_, index) => frame(index)) };
    expect(appendRecordingFrame(full, frame(1001))).toBe(false);
  });

  it('replays identically on a fixed clock including hold, loss and gradual recovery', () => {
    const profile = createDefaultProfile('hash', 'fixture', capabilities), source = recorded();
    const before = structuredClone({ source, profile });
    const first = evaluateRecording(source, profile), second = evaluateRecording(parseRecording(JSON.stringify(source)), profile);
    expect(first).toEqual(second); expect(first).toHaveLength(73);
    expect(first[0]!.tracking).toBe('lost'); expect(first[2]!.tracking).toBe('live'); expect(first[7]!.tracking).toBe('hold');
    expect(first[60]).toMatchObject({ tracking: 'lost', expressions: { aa: 0 } });
    for (const angle of Object.values(first[60]!.rotation)) expect(angle).toBeCloseTo(0);
    expect(first[66]).toMatchObject({ tracking: 'live', expressions: { aa: 0 } });
    expect(first[72]!.expressions.aa).toBeGreaterThan(0);
    expect({ source, profile }).toEqual(before);
  });

  it('round-trips valid named parameters and rejects unknown versions, fields and prototype keys', () => {
    expect(parseRecording(JSON.stringify(recorded()))).toEqual(recorded());
    expect(() => parseRecording('{')).toThrow('JSON');
    expect(() => parseRecording(JSON.stringify({ ...recorded(), schemaVersion: 2 }))).toThrow();
    expect(() => parseRecording(JSON.stringify({ ...recorded(), video: 'data:video/mp4,...' }))).toThrow();
    expect(() => parseRecording('{"schemaVersion":1,"durationMs":1,"frames":[],"__proto__":{"polluted":true}}')).toThrow();
    expect(() => parseRecording(JSON.stringify({ ...recorded(), frames: [{ ...frame(1), channels: { unknown: 0.5 } }] }))).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects invalid times, oversized payloads, rotations and coefficients before replay', () => {
    for (const frames of [[], [frame(2), frame(1)], [frame(1), frame(1)], [frame(-1)], [frame(1300)],
      [{ ...frame(1), channels: { jawOpen: -0.1 } }], [{ ...frame(1), channels: { jawOpen: 1.01 } }],
      [{ ...frame(1), rotation: { x: 4, y: 0, z: 0 } }], [{ ...frame(1), inferenceMs: -1 }],
      Array.from({ length: 1001 }, (_, index) => frame(index))]) {
      expect(() => parseRecording(JSON.stringify({ ...recorded(), frames }))).toThrow();
    }
    expect(() => parseRecording(JSON.stringify({ ...recorded(), durationMs: 30001 }))).toThrow();
    expect(() => parseRecording(JSON.stringify(recorded()).replace('"inferenceMs":12', '"inferenceMs":1e999'))).toThrow();
    expect(() => parseRecording(' '.repeat(8_000_001))).toThrow('8 MB');
  });
});
