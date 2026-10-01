import { describe, expect, it } from 'vitest';
import { jitterRms, reductionPercent, compareRecording } from '../../src/features/diagnostics/evaluation';
import type { AvatarCapabilities, TrackingFrame } from '../../src/core/contracts';
import { createDefaultProfile } from '../../src/core/retargeting';
const capabilities: AvatarCapabilities = { version: '1', name: 'test', bones: { head: true, leftEye: false, rightEye: false },
  expressions: [{ name: 'aa', preset: true, bindCount: 1, isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none' }], morphTargets: ['aa'], missing: [], level: 'face', vertexCount: 10 };
const source = () => ({ schemaVersion: 1 as const, durationMs: 8000, frames: Array.from({ length: 241 }, (_, i): TrackingFrame => ({ schemaVersion: 1, timestamp: i * 1000 / 30, faceDetected: true, inferenceMs: 1, channels: { jawOpen: .3 + (i % 2 ? .01 : -.01) }, rotation: { x: .1 + (i % 2 ? .02 : -.02), y: 0, z: 0 } })) });
describe('final-test offline metrics', () => {
  it('measures jitter about the mean, without mixing a fixed pose offset into RMS', () => {
    expect(jitterRms([9, 11])).toBe(1); expect(jitterRms([99, 101])).toBe(1);
    expect(reductionPercent(1, .5)).toBe(50); expect(reductionPercent(1, 2)).toBe(-100);
    expect(() => jitterRms([NaN])).toThrow(); expect(() => jitterRms([])).toThrow();
  });
  it('reports absent baseline noise as not measurable rather than a false pass', () => {
    expect(reductionPercent(0, 0)).toBeNull(); expect(reductionPercent(0, 1)).toBeNull();
    expect(reductionPercent(1e-10, 0)).toBeNull();
  });
  it('compares identical input and windows, keeps profiles immutable and separates head/shape units', () => {
    const profile = createDefaultProfile('hash', 'test', capabilities), clip = source(); profile.smoothing = .65;
    const before = structuredClone({ profile, clip });
    const result = compareRecording(clip, profile, undefined, 1000, 7000);
    expect(result.summary.headCombined.reductionPercent).toBeGreaterThan(30);
    expect(result.summary.head.y.reductionPercent).toBeNull();
    expect(result.summary.expressions.aa).toBeDefined(); expect(result.summary.excludedNonLiveSamples).toBe(0);
    expect({ profile, clip }).toEqual(before); expect(result.baseline).toHaveLength(result.selected.length);
    const unsmoothed = compareRecording(clip, { ...profile, smoothing: 0 }, undefined, 1000, 7000);
    expect(unsmoothed.summary.headCombined.reductionPercent).toBeCloseTo(0);
  });
  it('rejects invalid windows and a clip without a usable live face', () => {
    const profile = createDefaultProfile('hash', 'test', capabilities), clip = source();
    for (const [start,end] of [[-1,5000], [5000,1000], [0,9000], [NaN,5000]]) expect(() => compareRecording(clip, profile, undefined, start, end)).toThrow();
    clip.frames.forEach(frame => { frame.faceDetected = false; });
    expect(() => compareRecording(clip, profile)).toThrow('有效人脸样本不足');
  });
});
