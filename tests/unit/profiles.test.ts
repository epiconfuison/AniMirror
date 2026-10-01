import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UI } from '../../src/core/contracts';
import type { AvatarCapabilities, UserCalibration } from '../../src/core/contracts';
import { createDefaultProfile } from '../../src/core/retargeting';
import { parseBundle, ProfileRepository, serializeBundle, validateModelProfile } from '../../src/core/profiles';

const capabilities: AvatarCapabilities = { version: '1', name: 'fixture', bones: { head: true, leftEye: false, rightEye: false },
  expressions: [{ name: 'aa', preset: true, bindCount: 1, isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none' }],
  morphTargets: ['aa'], missing: [], level: 'face', vertexCount: 10 };
const profile = () => createDefaultProfile('model-hash', 'fixture.vrm', capabilities);
const calibration: UserCalibration = { schemaVersion: 1, profileId: 'default', createdAt: '2026-09-29T00:00:00.000Z',
  neutral: { jawOpen: 0.1 }, ranges: { jawOpen: 0.7 }, neutralRotation: { x: 0, y: 0, z: 0 }, quality: { neutral: 1, mouth: 0.9 } };

describe('strict config import', () => {
  it('round-trips separate model, personal and UI sections', () => {
    const bundle = { schemaVersion: 1 as const, model: profile(), calibration, ui: DEFAULT_UI };
    expect(parseBundle(serializeBundle(bundle), 'model-hash', capabilities)).toEqual(bundle);
    expect(parseBundle(serializeBundle({ schemaVersion: 1, calibration }), 'another-model', capabilities).calibration).toEqual(calibration);
  });
  it('rejects damaged JSON, unknown versions, mismatched models, and unknown channels or targets', () => {
    expect(() => parseBundle('{')).toThrow('JSON');
    expect(() => parseBundle('{"schemaVersion":2,"ui":{}}')).toThrow('schemaVersion');
    const config = profile();
    expect(() => parseBundle(JSON.stringify({ schemaVersion: 1, model: config }), 'other', capabilities)).toThrow('哈希');
    config.mappings[0]!.input = 'notAChannel'; expect(() => validateModelProfile(config)).toThrow('未知输入');
    config.mappings[0]!.input = 'jawOpen'; config.mappings[0]!.target = 'notInModel';
    expect(() => validateModelProfile(config, 'model-hash', capabilities)).toThrow('没有可驱动目标');
  });
  it('clamps finite unsafe ranges, but rejects nonfinite values and inverted bounds', () => {
    const config = profile(); config.headGain = 100; config.headLimits.y = 20; config.smoothing = -3; config.tuning.jawOpen!.gain = 10;
    const parsed = validateModelProfile(config);
    expect(parsed.headGain).toBe(3); expect(parsed.headLimits.y).toBe(Math.PI / 2); expect(parsed.smoothing).toBe(0); expect(parsed.tuning.jawOpen!.gain).toBe(3);
    config.headGain = Infinity; expect(() => validateModelProfile(config)).toThrow('有限');
    config.headGain = 1; config.tuning.jawOpen!.min = 0.9; config.tuning.jawOpen!.max = 0.2;
    expect(() => validateModelProfile(config)).toThrow('下限');
    expect(() => parseBundle('{"schemaVersion":1,"model":{"headGain":1e999}}')).toThrow();
  });
  it('rejects duplicate rule ids, prototype keys and unknown fields', () => {
    const config = profile(); config.mappings.push({ ...config.mappings[0]! });
    expect(() => validateModelProfile(config)).toThrow('重复');
    expect(() => parseBundle('{"schemaVersion":1,"__proto__":{"polluted":true},"ui":{}}')).toThrow('未知字段');
    expect(() => parseBundle(JSON.stringify({ schemaVersion: 1, calibration: { ...calibration, ranges: { mystery: 0.5 } } }))).toThrow('未知通道');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('independent IndexedDB persistence', () => {
  it('restores by model hash and persists personal calibration separately across repository instances', async () => {
    const name = `ar-capture-test-${crypto.randomUUID()}`, first = new ProfileRepository(name);
    await first.saveModel(profile()); await first.saveCalibration(calibration); await first.saveUI(DEFAULT_UI); await first.close();
    const second = new ProfileRepository(name);
    expect(await second.getModel('model-hash', capabilities)).toEqual(profile());
    expect(await second.getModel('different-file')).toBeUndefined();
    expect(await second.getCalibration()).toEqual(calibration); expect(await second.getUI()).toEqual(DEFAULT_UI);
    await second.clear(); await second.close();
    const third = new ProfileRepository(name);
    expect(await third.getModel('model-hash')).toBeUndefined(); expect(await third.getCalibration()).toBeUndefined(); expect(await third.getUI()).toBeUndefined();
    await third.close();
  });
  it('validates before save and validates stored data again when reading', async () => {
    const repository = new ProfileRepository(`ar-capture-invalid-${crypto.randomUUID()}`);
    const invalid = profile(); invalid.schemaVersion = 99 as 1;
    await expect(repository.saveModel(invalid)).rejects.toThrow('schemaVersion');
    expect(await repository.getModel(invalid.modelHash)).toBeUndefined();
    await repository.saveModel(profile());
    await expect(repository.getModel('model-hash', { ...capabilities, expressions: [] })).rejects.toThrow('没有可驱动目标');
    await repository.clear(); await repository.close();
  });
  it('deletes personal calibration independently without reviving it after reopen', async () => {
    const name = `ar-capture-reset-${crypto.randomUUID()}`, repository = new ProfileRepository(name);
    await repository.saveModel(profile()); await repository.saveCalibration(calibration); await repository.saveUI(DEFAULT_UI);
    await repository.removeCalibration(); await repository.close();
    const reopened = new ProfileRepository(name);
    expect(await reopened.getCalibration()).toBeUndefined();
    expect(await reopened.getModel('model-hash')).toEqual(profile()); expect(await reopened.getUI()).toEqual(DEFAULT_UI);
    await reopened.clear(); await reopened.close();
  });
});
