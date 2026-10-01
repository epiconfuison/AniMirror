import { afterEach, describe, expect, it, vi } from 'vitest';
import { Euler, Matrix4 } from 'three';
import { FrameGate, toTrackingFrame } from '../../src/core/tracking/result';
import { cameraErrorMessage } from '../../src/core/tracking/errors';
import { CameraController } from '../../src/core/tracking/CameraController';
afterEach(() => vi.unstubAllGlobals());
describe('tracking contracts and lifecycle', () => {
  it('keeps anatomical names independent of array order and decomposes combined head rotation', () => {
    const rotation = new Euler(.1, -.25, .07, 'YXZ');
    const result = toTrackingFrame({ faceLandmarks: [Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }))], faceBlendshapes: [{ categories: [{ categoryName: 'eyeBlinkRight', score: .2 }, { categoryName: 'jawOpen', score: 2 }, { categoryName: 'eyeBlinkLeft', score: .8 }] }], facialTransformationMatrixes: [{ data: new Matrix4().makeRotationFromEuler(rotation).toArray() }] }, 100, 9);
    expect(result.faceDetected).toBe(true); expect(result.channels).toEqual({ eyeBlinkRight: .2, jawOpen: 1, eyeBlinkLeft: .8 });
    expect(result.rotation.x).toBeCloseTo(rotation.x); expect(result.rotation.y).toBeCloseTo(rotation.y); expect(result.rotation.z).toBeCloseTo(rotation.z);
    expect(toTrackingFrame({ faceLandmarks: [[{ x: 1, y: 1, z: 0 }]] }, 200, 3).faceDetected).toBe(false);
  });
  it('drops busy and old frames instead of queueing and releases after inference', () => {
    const gate = new FrameGate(); expect(gate.acquire(100)).toBe(true); expect(gate.acquire(120)).toBe(false);
    gate.release(); expect(gate.acquire(90)).toBe(false); expect(gate.acquire(150)).toBe(true);
    gate.reset(); expect(gate.acquire(1)).toBe(true);
  });
  it('explains permission, missing, busy and unplugged devices distinctly', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toContain('权限被拒绝');
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toContain('没有找到');
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toContain('占用');
    expect(cameraErrorMessage({ name: 'OverconstrainedError' })).toContain('拔出');
  });
  it('stops a camera whose permission request resolves after the user cancelled startup', async () => {
    let resolve!: (stream: MediaStream) => void;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(r => { resolve = r; }) } });
    vi.stubGlobal('Worker', class {}); vi.stubGlobal('OffscreenCanvas', class {}); vi.stubGlobal('createImageBitmap', vi.fn());
    const stop = vi.fn(), stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const video = { pause: vi.fn(), srcObject: null } as unknown as HTMLVideoElement;
    const states: string[] = [], controller = new CameraController(video, { onFrame: vi.fn(), onState: s => states.push(s) });
    const starting = controller.start(); controller.stop(); resolve(stream); await starting;
    expect(stop).toHaveBeenCalledOnce(); expect(video.srcObject).toBeNull(); expect(controller.state).toBe('idle'); expect(states).not.toContain('running');
  });
});
