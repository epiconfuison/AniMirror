import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { Mesh, Vector3 } from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { loadAvatar } from '../../src/core/avatar/loadAvatar';
import { validateVRMBuffer, hashAvatar, MAX_AVATAR_BYTES } from '../../src/core/avatar/validation';
import { AvatarDriver } from '../../src/core/avatar/AvatarDriver';
import { inspectAvatar } from '../../src/core/avatar/capabilities';
import { AvatarStage } from '../../src/features/preview/AvatarStage';

// Keep real GLTF/VRM loading while replacing only browser GPU and pointer plumbing.
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = { style: {}, setAttribute: vi.fn(), remove: vi.fn() };
    setPixelRatio() {} setSize() {} render() {} dispose() {} forceContextLoss() {}
  } };
});
vi.mock('three/addons/controls/OrbitControls.js', () => ({ OrbitControls: class {
  target = new Vector3(); update() {} saveState() {} dispose() {}
} }));

async function fixture(name = 'diagnostic-vrm1-rich.vrm') {
  const bytes = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
function rewriteJSON(buffer: ArrayBuffer, update: (json: any) => void): ArrayBuffer {
  const view = new DataView(buffer), oldLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, oldLength)));
  update(json);
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(bytes.length / 4) * 4;
  const tail = new Uint8Array(buffer, 20 + oldLength);
  const result = new Uint8Array(20 + padded + tail.length);
  result.set(new Uint8Array(buffer, 0, 20));
  result.fill(0x20, 20, 20 + padded);
  result.set(bytes, 20); result.set(tail, 20 + padded);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(8, result.length, true); resultView.setUint32(12, padded, true);
  return result.buffer;
}

describe('local VRM import boundary', () => {
  it('accepts both versions and rejects renamed GLB or invalid headers', async () => {
    const rich = await fixture();
    expect(validateVRMBuffer(rich).version).toBe('1');
    expect(validateVRMBuffer(await fixture('diagnostic-vrm0.vrm')).version).toBe('0');
    expect(() => validateVRMBuffer(rich, 'avatar.glb')).toThrow('.vrm');
    expect(() => validateVRMBuffer(new ArrayBuffer(30))).toThrow('GLB');
    expect(() => validateVRMBuffer(rich.slice(0, -4))).toThrow('长度');
    expect(() => validateVRMBuffer(rewriteJSON(rich, json => { json.extensions = {}; }))).toThrow('VRM 扩展');
  });

  it('rejects oversize files before reading and rejects external URIs including extension resources', async () => {
    await expect(loadAvatar({ size: MAX_AVATAR_BYTES + 1 } as File)).rejects.toThrow('100 MB');
    const bytes = await fixture();
    for (const uri of ['https://example.invalid/texture.png', '../secret.bin', 'file:///secret.bin', '//example.invalid/a', 'blob:untrusted']) {
      expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { json.images = [{ uri }]; }))).toThrow('外部资源');
    }
    expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { json.extensions.vendor = { nested: { uri: '/private.bin' } }; }))).toThrow('外部资源');
  });

  it('rejects missing bones, truncated embedded resources and unreasonable vertex counts', async () => {
    const bytes = await fixture();
    expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { delete json.extensions.VRMC_vrm.humanoid.humanBones.head; }))).toThrow('head');
    expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { json.buffers[0].byteLength += 100; }))).toThrow('截断');
    expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { json.bufferViews[0].byteOffset = json.buffers[0].byteLength; }))).toThrow('越界');
    expect(() => validateVRMBuffer(rewriteJSON(bytes, json => { json.accessors[0].count = 5_000_001; }))).toThrow('500 万');
  });

  it('hashes file bytes, independent of a filename, for profile restore', async () => {
    const bytes = await fixture();
    const first = await hashAvatar(bytes);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashAvatar(bytes.slice(0))).toBe(first);
    expect(await hashAvatar(await fixture('diagnostic-vrm1-minimal.vrm'))).not.toBe(first);
  });
});

describe('preview replacement lifecycle with a real model loader', () => {
  it('retains the old model after failed replacement and releases resources on success/dispose', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = new AvatarStage({ clientWidth: 800, clientHeight: 600, appendChild() {} } as unknown as HTMLElement);
    try {
      await stage.load(new File([await fixture()], 'first.vrm'));
      const internals = stage as unknown as { loaded: Awaited<ReturnType<typeof loadAvatar>> };
      const old = internals.loaded;
      let oldGeometry: Mesh['geometry'] | undefined;
      old.vrm.scene.traverse(node => { if (node instanceof Mesh) oldGeometry = node.geometry; });
      const disposed = vi.spyOn(oldGeometry!, 'dispose');
      await expect(stage.load(new File(['broken'], 'broken.vrm'))).rejects.toThrow();
      expect(internals.loaded).toBe(old);
      expect(disposed).not.toHaveBeenCalled();
      await stage.load(new File([await fixture('diagnostic-vrm1-minimal.vrm')], 'second.vrm'));
      expect(internals.loaded).not.toBe(old);
      expect(disposed).toHaveBeenCalledOnce();
      stage.dispose();
      expect(internals.loaded).toBeUndefined();
      expect(() => stage.dispose()).not.toThrow();
    } finally { stage.dispose(); vi.unstubAllGlobals(); }
  });
});

describe('three-vrm integration on original redistributable fixtures', () => {
  it.each(['diagnostic-vrm0.vrm', 'diagnostic-vrm1-rich.vrm'])('loads %s with real normalized expressions and independent left/right controls', async name => {
    const model = await loadAvatar(new File([await fixture(name)], name));
    try {
      expect(model.capabilities.level).toBe('rich');
      expect(model.capabilities.expressions.filter(expression => expression.bindCount > 0)).toHaveLength(13);
      expect(model.capabilities.bones).toEqual({ head: true, leftEye: true, rightEye: true });
      expect(model.capabilities.expressions.map(expression => expression.name)).toEqual(expect.arrayContaining(['aa', 'happy', 'blinkLeft', 'blinkRight']));
      const driver = new AvatarDriver(model.vrm);
      driver.apply({ expressions: { blinkLeft: 1, aa: 0.6 }, rotation: { x: 0, y: 0, z: 0 }, tracking: 'live' });
      model.vrm.update(1 / 60);
      let face: Mesh | undefined;
      model.vrm.scene.traverse(node => { if (node instanceof Mesh && node.morphTargetDictionary?.blinkLeft !== undefined) face = node; });
      expect(face).toBeDefined();
      expect(face!.morphTargetInfluences![face!.morphTargetDictionary!.blinkLeft]).toBeCloseTo(1);
      expect(face!.morphTargetInfluences![face!.morphTargetDictionary!.blinkRight]).toBe(0);
      expect(face!.morphTargetInfluences![face!.morphTargetDictionary!.aa]).toBeCloseTo(0.6);
      driver.apply({ expressions: { aa: 99, happy: NaN }, rotation: { x: 0, y: 0, z: 0 }, tracking: 'live' });
      model.vrm.update(1 / 60);
      expect(model.vrm.expressionManager!.getValue('blinkLeft')).toBe(0);
      expect(model.vrm.expressionManager!.getValue('aa')).toBe(1);
      expect(model.vrm.expressionManager!.getValue('happy')).toBe(0);
    } finally { VRMUtils.deepDispose(model.vrm.scene); }
  });

  it('loads a valid missing-channel model and reports limitations without invented mappings', async () => {
    const model = await loadAvatar(new File([await fixture('diagnostic-vrm1-minimal.vrm')], 'minimal.vrm'));
    try {
      expect(model.capabilities.level).toBe('basic');
      expect(model.capabilities.bones).toEqual({ head: true, leftEye: false, rightEye: false });
      expect(model.capabilities.expressions).toEqual([]);
      expect(model.capabilities.morphTargets).toEqual([]);
      expect(model.capabilities.missing.join(' ')).toContain('张嘴');
      expect(() => new AvatarDriver(model.vrm).apply({ expressions: {}, rotation: { x: 0.1, y: 0, z: 0 }, tracking: 'live' })).not.toThrow();
    } finally { VRMUtils.deepDispose(model.vrm.scene); }
  });

  it('does not report all-zero morph deltas as an effective expression bind', async () => {
    const model = await loadAvatar(new File([await fixture()], 'rich.vrm'));
    try {
      model.vrm.scene.traverse(node => { if (node instanceof Mesh) for (const attribute of node.geometry.morphAttributes.position ?? []) attribute.array.fill(0); });
      const capabilities = inspectAvatar(model.vrm, '1', 'Empty morphs');
      expect(capabilities.expressions.every(expression => expression.bindCount === 0)).toBe(true);
      expect(capabilities.level).toBe('basic');
    } finally { VRMUtils.deepDispose(model.vrm.scene); }
  });

  it('normalizes VRM0 and VRM1 head pitch, yaw and roll to matching visible directions', async () => {
    const models = await Promise.all(['diagnostic-vrm0.vrm', 'diagnostic-vrm1-rich.vrm'].map(async name => loadAvatar(new File([await fixture(name)], name))));
    const drivers = models.map(model => new AvatarDriver(model.vrm));
    try {
      for (const rotation of [{ x: 0.3, y: 0, z: 0 }, { x: 0, y: 0.4, z: 0 }, { x: 0, y: 0, z: -0.2 }]) {
        const axes = models.map((model, index) => {
          drivers[index].apply({ expressions: {}, rotation, tracking: 'live' });
          model.vrm.update(1 / 60); model.vrm.scene.updateMatrixWorld(true);
          const head = model.vrm.humanoid.getRawBoneNode('head')!;
          // The fixtures encode their visible face as local +Z under a legacy rotated root.
          return {
            forward: new Vector3(0, 0, 1).transformDirection(head.matrixWorld),
            up: new Vector3(0, 1, 0).transformDirection(head.matrixWorld),
          };
        });
        expect(axes[0].forward.distanceTo(axes[1].forward)).toBeLessThan(1e-5);
        expect(axes[0].up.distanceTo(axes[1].up)).toBeLessThan(1e-5);
        // Roll leaves the forward vector unchanged, so check the up axis too.
        const displacement = rotation.z
          ? axes[0].up.distanceTo(new Vector3(0, 1, 0))
          : axes[0].forward.distanceTo(new Vector3(0, 0, 1));
        expect(displacement).toBeGreaterThan(0.15);
      }
    } finally { models.forEach(model => VRMUtils.deepDispose(model.vrm.scene)); }
  });
});
