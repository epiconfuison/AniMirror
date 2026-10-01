import { describe, expect, it } from 'vitest';
import type { AvatarCapabilities, TrackingFrame } from '../../src/core/contracts';
import { CalibrationCollector, createDefaultProfile, Retargeter, suggestMappings } from '../../src/core/retargeting';

const capabilities = (names = ['blinkLeft', 'blinkRight', 'aa', 'happy']): AvatarCapabilities => ({
  version: '1', name: 'fixture', bones: { head: true, leftEye: false, rightEye: false },
  expressions: names.map((name) => ({ name, preset: true, bindCount: 1, isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none' })),
  morphTargets: names, missing: [], level: 'face', vertexCount: 100,
});
const frame = (timestamp: number, channels: Record<string, number> = {}, faceDetected = true): TrackingFrame => ({
  schemaVersion: 1, timestamp, faceDetected, channels, rotation: { x: 0, y: 0, z: 0 }, inferenceMs: 10,
});
const profile = () => {
  const result = createDefaultProfile('hash', 'fixture', capabilities()); result.smoothing = 0;
  for (const tuning of Object.values(result.tuning)) tuning.deadZone = 0;
  return result;
};
const basicChannels = { eyeBlinkLeft: 0.02, eyeBlinkRight: 0.02, jawOpen: 0.05, mouthSmileLeft: 0.05, mouthSmileRight: 0.05 };

describe('semantic mapping and composition', () => {
  it('recognizes version aliases, prefers named individual controls, and never drives empty bindings', () => {
    const model = capabilities(['blink_l', 'blink_r', 'a', 'joy', 'mouthSmileLeft', 'cheekPuff']);
    model.expressions.find((entry) => entry.name === 'cheekPuff')!.bindCount = 0;
    const rules = suggestMappings(model);
    expect(rules.find((rule) => rule.input === 'jawOpen')).toMatchObject({ target: 'a', confirmed: true });
    expect(rules.find((rule) => rule.input === 'mouthSmileLeft')).toMatchObject({ target: 'mouthSmileLeft', approximate: false });
    expect(rules.find((rule) => rule.input === 'mouthSmileRight')).toMatchObject({ target: 'joy', approximate: true, confirmed: false });
    expect(rules.some((rule) => rule.target === 'cheekPuff')).toBe(false);
  });
  it('requires confirmation of approximation and supports many-to-many weighted sums', () => {
    const config = profile(); const engine = new Retargeter();
    expect(engine.update(frame(0, { mouthSmileLeft: 1, mouthSmileRight: 1 }), config, undefined, 0).expressions.happy).toBe(0);
    config.mappings.forEach((rule) => { rule.confirmed = true; });
    config.mappings.push({ ...config.mappings.find((rule) => rule.input === 'jawOpen')!, id: 'extra', target: 'happy', weight: 0.25 });
    const result = engine.update(frame(20, { mouthSmileLeft: 0.6, mouthSmileRight: 0.4, jawOpen: 0.8 }), config, undefined, 20);
    expect(result.expressions.happy).toBeCloseTo(0.7);
    expect(result.expressions.aa).toBeCloseTo(0.8);
  });
  it('clears deleted mappings and isolates manual tests from tracked values', () => {
    const config = profile(); const engine = new Retargeter();
    expect(engine.update(frame(0, { jawOpen: 0.7 }), config, undefined, 0, { aa: 1 }).expressions.aa).toBe(1);
    expect(engine.update(frame(20, { jawOpen: 0.7 }), config, undefined, 20).expressions.aa).toBeCloseTo(0.7);
    config.mappings = config.mappings.filter((rule) => rule.target !== 'aa');
    expect(engine.update(frame(40, { jawOpen: 1 }), config, undefined, 40).expressions.aa).toBe(0);
  });
  it('applies personal calibration independently of model tuning and clamps head motion', () => {
    const config = profile(); config.tuning.jawOpen = { gain: 2, deadZone: 0.1, min: 0, max: 0.7, curve: 1 };
    const calibrated = { schemaVersion: 1 as const, profileId: 'default', createdAt: new Date().toISOString(),
      neutral: { jawOpen: 0.2 }, ranges: { jawOpen: 0.4 }, neutralRotation: { x: 0.1, y: 0, z: 0 }, quality: { neutral: 1 } };
    const sample = frame(0, { jawOpen: 0.4 }); sample.rotation = { x: 0.3, y: 3, z: -2 };
    const result = new Retargeter().update(sample, config, calibrated, 0);
    expect(result.expressions.aa).toBe(0.7);
    expect(result.rotation.x).toBeCloseTo(0.2);
    expect(result.rotation.y).toBe(config.headLimits.y);
    expect(result.rotation.z).toBe(-config.headLimits.z);
    expect(calibrated.ranges.jawOpen).toBe(0.4);
  });
});

describe('tracking timing, loss, and smoothing', () => {
  it('ignores out-of-order, future and stale results', () => {
    const config = profile(), engine = new Retargeter();
    engine.update(frame(100, { jawOpen: 0.6 }), config, undefined, 100);
    expect(engine.update(frame(90, { jawOpen: 1 }), config, undefined, 110).expressions.aa).toBe(0.6);
    expect(engine.update(frame(900, { jawOpen: 1 }), config, undefined, 120).expressions.aa).toBe(0.6);
    const late = new Retargeter().update(frame(0, { jawOpen: 1 }), config, undefined, 1000);
    expect(late.tracking).toBe('lost'); expect(late.expressions.aa).toBe(0);
  });
  it('holds a brief loss, fades to neutral, then recovers gradually even with smoothing off', () => {
    const config = profile(), engine = new Retargeter();
    engine.update(frame(0, { jawOpen: 1 }), config, undefined, 0);
    expect(engine.update(frame(100, {}, false), config, undefined, 100)).toMatchObject({ tracking: 'hold', expressions: { aa: 1 } });
    expect(engine.update(null, config, undefined, 500).expressions.aa).toBeCloseTo(1 - 250 / 550);
    expect(engine.update(null, config, undefined, 800)).toMatchObject({ tracking: 'lost', expressions: { aa: 0 } });
    expect(engine.update(frame(850, { jawOpen: 1 }), config, undefined, 850).expressions.aa).toBe(0);
    expect(engine.update(frame(940, { jawOpen: 1 }), config, undefined, 940).expressions.aa).toBeCloseTo(0.5);
    expect(engine.update(frame(1030, { jawOpen: 1 }), config, undefined, 1030).expressions.aa).toBe(1);
  });
  it('detects stalled inference even when the caller keeps passing the last valid frame', () => {
    const config = profile(), engine = new Retargeter(), sample = frame(0, { jawOpen: 1 });
    engine.update(sample, config, undefined, 0);
    expect(engine.update(sample, config, undefined, 220).tracking).toBe('hold');
    expect(engine.update(sample, config, undefined, 850).expressions.aa).toBe(0);
  });
  it('reduces static jitter by at least 30% and preserves brief blinks and fast jaw opening', () => {
    const config = profile(); config.smoothing = 0.65;
    config.mappings.forEach((rule) => { rule.confirmed = true; });
    const engine = new Retargeter(), raw: number[] = [], smooth: number[] = [];
    for (let index = 0; index < 240; index++) {
      const value = 0.45 + (index % 2 ? 0.025 : -0.025);
      const output = engine.update(frame(index * 16.667, { mouthSmileLeft: value, mouthSmileRight: value }), config, undefined, index * 16.667);
      if (index >= 60) { raw.push(value); smooth.push(output.expressions.happy!); }
    }
    const rms = (values: number[]) => Math.sqrt(values.reduce((total, value) => total + (value - 0.45) ** 2, 0) / values.length);
    expect(rms(smooth)).toBeLessThan(rms(raw) * 0.7);
    const opened = engine.update(frame(4000, { eyeBlinkLeft: 1, jawOpen: 1 }), config, undefined, 4000);
    expect(opened.expressions.blinkLeft).toBeGreaterThan(0.7);
    expect(opened.expressions.aa).toBeGreaterThan(0.7);
    const closed = engine.update(frame(4034, {}), config, undefined, 4034);
    expect(closed.expressions.blinkLeft).toBeLessThan(0.1);
  });
});

describe('personal calibration', () => {
  it('samples only unique valid detections, rejects inadequate actions, and supports retry', () => {
    const collector = new CalibrationCollector(); collector.start('neutral');
    collector.add(frame(0, basicChannels, false));
    collector.add(frame(1, basicChannels)); collector.add(frame(1, basicChannels));
    expect(collector.sampleCount).toBe(1); expect(collector.finish().ok).toBe(false);
    for (let index = 2; index <= 30; index++) collector.add(frame(index, basicChannels));
    expect(collector.finish().ok).toBe(true);
    collector.start('mouth');
    for (let index = 0; index < 30; index++) collector.add(frame(index, basicChannels));
    expect(collector.finish()).toMatchObject({ ok: false });
    collector.start('mouth');
    for (let index = 0; index < 30; index++) collector.add(frame(index, { ...basicChannels, jawOpen: 0.65 }));
    const result = collector.finish(); expect(result.ok).toBe(true);
    if (result.ok) expect(result.calibration.ranges.jawOpen).toBeCloseTo(0.6);
  });
  it('requires neutral first and rejects moving or closed-eye neutral samples', () => {
    const collector = new CalibrationCollector(); collector.start('blink');
    for (let index = 0; index < 30; index++) collector.add(frame(index, { ...basicChannels, eyeBlinkLeft: 1, eyeBlinkRight: 1 }));
    expect(collector.finish()).toMatchObject({ ok: false, error: expect.stringContaining('中性脸') });
    collector.start('neutral');
    for (let index = 0; index < 30; index++) {
      const sample = frame(index, basicChannels); sample.rotation.y = index * 0.03; collector.add(sample);
    }
    expect(collector.finish()).toMatchObject({ ok: false, error: expect.stringContaining('移动过多') });
    collector.start('neutral');
    for (let index = 0; index < 30; index++) collector.add(frame(index, { ...basicChannels, eyeBlinkLeft: 1 }));
    expect(collector.finish().ok).toBe(false);
  });
});
