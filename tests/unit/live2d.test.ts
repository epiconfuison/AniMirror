import { describe, expect, it } from 'vitest';
import type { Live2DCapabilities } from '../../src/core/contracts';
import { normalizePackPath, packFromFiles, resolveReference, selectEntry } from '../../src/core/live2d/pack';
import { readManifest } from '../../src/core/live2d/manifest';
import { hashModelPack } from '../../src/core/live2d/identity';
import { headParameterValues, parameterValue, suggestLive2DMappings } from '../../src/core/live2d/parameters';
import { CubismUnavailableError, ensureCubismRuntime, isCubismCoreAvailable } from '../../src/core/live2d/runtime';

function file(path: string, content: string | Uint8Array): File {
  const handle = new File([content as BlobPart], path.split('/').pop()!, { type: 'application/octet-stream' });
  Object.defineProperty(handle, 'webkitRelativePath', { value: path });
  return handle;
}

const manifest = (overrides: Record<string, unknown> = {}) => ({
  Version: 3,
  FileReferences: {
    Moc: 'Hiyori.moc3',
    Textures: ['Hiyori.2048/texture_00.png'],
    Physics: 'Hiyori.physics3.json',
    Pose: 'Hiyori.pose3.json',
    Expressions: [{ Name: 'smile', File: 'expressions/smile.exp3.json' }],
    Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
  },
  Groups: [{ Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] }],
  Layout: { width: 2, height: 2 },
  ...overrides,
});

const packFiles = (body: unknown = manifest(), options: { extra?: [string, string | Uint8Array][]; replace?: Record<string, string | Uint8Array> } = {}) => {
  const entries: [string, string | Uint8Array][] = [
    ['Hiyori/Hiyori.model3.json', JSON.stringify(body)],
    ['Hiyori/Hiyori.moc3', new Uint8Array([1, 2, 3, 4])],
    ['Hiyori/Hiyori.2048/texture_00.png', new Uint8Array([137, 80, 78, 71])],
    ['Hiyori/Hiyori.physics3.json', '{"Version":3}'],
    ['Hiyori/Hiyori.pose3.json', '{"Version":3}'],
    ['Hiyori/expressions/smile.exp3.json', '{"Type":"Live2D Expression","Parameters":[]}'],
    ['Hiyori/motions/idle.motion3.json', '{"Version":3}'],
  ];
  for (const [path, content] of Object.entries(options.replace ?? {})) {
    const index = entries.findIndex(([entry]) => entry === path);
    if (index < 0) throw new Error(`unknown fixture ${path}`);
    entries[index] = [path, content];
  }
  entries.push(...options.extra ?? []);
  return entries.map(([path, content]) => file(path, content));
};

describe('Live2D package boundary', () => {
  it('normalises relative paths and refuses absolute, external or traversal references', () => {
    expect(normalizePackPath('Hiyori\\textures\\a.png')).toBe('Hiyori/textures/a.png');
    expect(normalizePackPath('./Hiyori/./a.png')).toBe('Hiyori/a.png');
    for (const bad of ['../outside.png', '/etc/passwd', 'C:/Windows/x.png', 'https://example.invalid/x.png', 'blob:abc', 'file:///x', '']) {
      expect(() => normalizePackPath(bad)).toThrow();
    }
    expect(resolveReference('Hiyori/Hiyori.model3.json', 'Hiyori.2048/texture_00.png')).toBe('Hiyori/Hiyori.2048/texture_00.png');
    expect(() => resolveReference('Hiyori/Hiyori.model3.json', '../../secret.png')).toThrow('跳出');
  });

  it('accepts one model folder and rejects unsupported files, duplicates and ambiguous model folders', async () => {
    const pack = await packFromFiles(packFiles());
    expect(pack.entry).toBe('Hiyori/Hiyori.model3.json');
    expect(pack.totalBytes).toBeGreaterThan(0);
    await expect(packFromFiles([...packFiles(), file('Hiyori/virus.exe', 'MZ')])).rejects.toThrow('不支持的文件类型');
    await expect(packFromFiles([...packFiles(), file('Hiyori/Hiyori.moc3', new Uint8Array([9]))])).rejects.toThrow('重复');
    await expect(packFromFiles(packFiles().slice(1))).rejects.toThrow('.model3.json');
    const two = [...packFiles(), file('Other/Other.model3.json', JSON.stringify(manifest()))];
    await expect(packFromFiles(two)).rejects.toThrow('多个模型描述文件');
    expect(selectEntry(new Map([['A/A.model3.json', { path: 'A/A.model3.json', size: 1, bytes: async () => new ArrayBuffer(1) }]]))).toBe('A/A.model3.json');
  });

  it('rejects an oversized single file before reading any bytes', async () => {
    const huge = file('Hiyori/Hiyori.2048/texture_01.png', new Uint8Array(8));
    Object.defineProperty(huge, 'size', { value: 65 * 1024 * 1024 });
    await expect(packFromFiles([...packFiles(), huge])).rejects.toThrow('64 MB');
  });
});

describe('model3.json manifest', () => {
  it('resolves every declared resource and records the identity set', async () => {
    const pack = await packFromFiles(packFiles());
    const parsed = await readManifest(pack);
    expect(parsed.moc).toBe('Hiyori/Hiyori.moc3');
    expect(parsed.textures).toEqual(['Hiyori/Hiyori.2048/texture_00.png']);
    expect(parsed.physics).toBe('Hiyori/Hiyori.physics3.json');
    expect(parsed.expressions).toEqual([{ name: 'smile', path: 'Hiyori/expressions/smile.exp3.json' }]);
    expect(parsed.motions).toEqual(['Hiyori/motions/idle.motion3.json']);
    expect(parsed.references).toContain('Hiyori/Hiyori.model3.json');
    expect(parsed.references).toContain('Hiyori/expressions/smile.exp3.json');
    expect(parsed.layout).toEqual({ width: 2, height: 2 });
  });

  it('rejects unknown versions, missing chapters and references outside the package', async () => {
    const cases: [string, unknown][] = [
      ['仅支持 Version 3', manifest({ Version: 2 })],
      ['缺少 FileReferences', manifest({ FileReferences: undefined })],
      ['必须指向 .moc3', manifest({ FileReferences: { Moc: 'Hiyori.json', Textures: ['Hiyori.2048/texture_00.png'] } })],
      ['缺少贴图', manifest({ FileReferences: { Moc: 'Hiyori.moc3', Textures: ['Hiyori.2048/missing.png'] } })],
      ['不是受支持的图片格式', manifest({ FileReferences: { Moc: 'Hiyori.moc3', Textures: ['Hiyori/Hiyori.moc3'] } })],
      ['没有声明任何贴图', manifest({ FileReferences: { Moc: 'Hiyori.moc3', Textures: [] } })],
      ['外部地址', manifest({ FileReferences: { Moc: 'Hiyori.moc3', Textures: ['https://example.invalid/a.png'] } })],
      ['不是受支持的布局键', manifest({ Layout: { mystery: 1 } })],
    ];
    for (const [message, body] of cases) {
      const pack = await packFromFiles(packFiles(body));
      await expect(readManifest(pack)).rejects.toThrow(message);
    }
  });

  it('refuses a JSON file that is not a model, even with a .model3.json name', async () => {
    const pack = await packFromFiles(packFiles({ hello: 'world' }));
    await expect(readManifest(pack)).rejects.toThrow('Version 3');
  });
});

describe('Live2D model identity', () => {
  it('hashes the referenced files, independent of file order and file names outside the set', async () => {
    const first = await packFromFiles(packFiles());
    const second = await packFromFiles(packFiles(manifest(), { extra: [['Hiyori/unused.json', '{"note":1}']] }).reverse());
    const firstManifest = await readManifest(first);
    const secondManifest = await readManifest(second);
    const id = await hashModelPack(first, firstManifest.references);
    expect(id).toMatch(/^live2d:[a-f0-9]{64}$/);
    expect(await hashModelPack(second, secondManifest.references)).toBe(id);
  });

  it('changes when any referenced file changes, so equal names never share a profile', async () => {
    const base = await packFromFiles(packFiles());
    const changed = await packFromFiles(packFiles(manifest(), { replace: { 'Hiyori/Hiyori.2048/texture_00.png': new Uint8Array([1]) } }));
    expect(await hashModelPack(changed, (await readManifest(changed)).references))
      .not.toBe(await hashModelPack(base, (await readManifest(base)).references));
  });
});

describe('Cubism parameter semantics', () => {
  it('reports a missing Cubism Core instead of failing with a null reference', () => {
    // The vendored SDK must be importable without the browser-only Core script.
    expect(isCubismCoreAvailable()).toBe(false);
    expect(() => ensureCubismRuntime()).toThrow(CubismUnavailableError);
    expect(() => ensureCubismRuntime()).toThrow('Cubism Core');
  });
  it('maps amounts from neutral for bipolar parameters and as a position for unipolar ones', () => {
    expect(parameterValue({ min: -1, max: 1, default: 0 }, 1)).toBe(1);
    expect(parameterValue({ min: -1, max: 1, default: 0 }, -1)).toBe(-1);
    expect(parameterValue({ min: -30, max: 30, default: 0 }, 0.5)).toBe(15);
    expect(parameterValue({ min: 0, max: 1, default: 1 }, 0)).toBe(0);
    expect(parameterValue({ min: 0, max: 1, default: 1 }, 1)).toBe(1);
    expect(parameterValue({ min: 0, max: 1, default: 0 }, 0.25)).toBe(0.25);
    expect(parameterValue({ min: 0, max: 1, default: 0 }, 4)).toBe(1);
    expect(parameterValue({ min: 0, max: 1, default: 0 }, Number.NaN)).toBe(0);
  });

  it('converts head radians to Cubism degrees with one documented axis mapping', () => {
    const values = headParameterValues({ x: Math.PI / 2, y: Math.PI / 3, z: 0 });
    expect(values.ParamAngleX).toBeCloseTo(60);
    expect(values.ParamAngleY).toBeCloseTo(90);
    expect(values.ParamAngleZ).toBe(0);
    expect(headParameterValues({ x: Number.NaN, y: 0, z: 0 }).ParamAngleY).toBe(0);
  });

  it('suggests only parameters the model exposes, with invert for eyes and unconfirmed gaze', () => {
    const capabilities: Live2DCapabilities = {
      format: 'live2d', name: 'fixture', level: 'face', missing: [], groups: {},
      parameters: [
        { id: 'ParamEyeLOpen', label: '左眼开合', group: '', min: 0, max: 1, default: 1 },
        { id: 'ParamMouthOpenY', label: '嘴部开合', group: '', min: 0, max: 1, default: 0 },
        { id: 'ParamAngleX', label: '头部左右转动', group: '', min: -30, max: 30, default: 0 },
      ],
      expressionNames: [], hasPhysics: false, hasPose: false, textureCount: 1, drawableCount: 1, mocVersion: 3,
    };
    const rules = suggestLive2DMappings(capabilities);
    const eye = rules.find((rule) => rule.target === 'ParamEyeLOpen');
    expect(eye).toMatchObject({ input: 'eyeBlinkLeft', invert: true, approximate: false, confirmed: true });
    expect(rules.some((rule) => rule.target === 'ParamEyeROpen')).toBe(false);
    expect(rules.find((rule) => rule.target === 'ParamMouthOpenY')).toMatchObject({ input: 'jawOpen' });
    expect(rules.every((rule) => ['ParamEyeLOpen', 'ParamMouthOpenY', 'ParamAngleX'].includes(rule.target))).toBe(true);
    expect(rules.some((rule) => rule.signed)).toBe(false);
  });

  it('marks gaze suggestions as signed but unconfirmed so they never drive silently', () => {
    const capabilities: Live2DCapabilities = {
      format: 'live2d', name: 'fixture', level: 'rich', missing: [], groups: {},
      parameters: [{ id: 'ParamEyeBallX', label: '视线水平', group: '', min: -1, max: 1, default: 0 }],
      expressionNames: [], hasPhysics: false, hasPose: false, textureCount: 1, drawableCount: 1, mocVersion: 3,
    };
    const gaze = suggestLive2DMappings(capabilities).filter((rule) => rule.target === 'ParamEyeBallX');
    expect(gaze.length).toBeGreaterThan(0);
    expect(gaze.every((rule) => rule.signed && rule.approximate && !rule.confirmed)).toBe(true);
  });
});
