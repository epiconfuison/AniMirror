import { Euler, Matrix4 } from 'three';
import type { TrackingFrame } from '../contracts';

export interface FaceTaskResult {
  faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  facialTransformationMatrixes?: Array<{ data: number[] }>;
}

/** MediaPipe face geometry is a column-major, right-handed camera transform.
 * Record YXZ Euler radians in camera coordinates (+X right, +Y up, camera looks -Z).
 * Mirror is a CSS preview preference and never changes these or anatomical names.
 */
export function toTrackingFrame(result: FaceTaskResult, timestamp: number, inferenceMs: number): TrackingFrame {
  const landmarks = result.faceLandmarks?.[0];
  const data = result.facialTransformationMatrixes?.[0]?.data;
  const faceDetected = Boolean(landmarks && landmarks.length >= 468 && landmarks.every(p => [p.x,p.y,p.z].every(Number.isFinite))
    && data?.length === 16 && data.every(Number.isFinite) && result.faceBlendshapes?.[0]?.categories.length);
  const channels: Record<string, number> = {};
  if (faceDetected) {
    for (const category of result.faceBlendshapes?.[0]?.categories ?? []) {
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(category.categoryName) && Number.isFinite(category.score)) {
        Object.defineProperty(channels, category.categoryName, { value: Math.max(0, Math.min(1, category.score)), enumerable: true });
      }
    }
  }
  let rotation = { x: 0, y: 0, z: 0 };
  if (faceDetected && data?.length === 16 && data.every(Number.isFinite)) {
    // extractRotation strips the face geometry scale before computing angles.
    const matrix = new Matrix4().extractRotation(new Matrix4().fromArray(data));
    const angles = new Euler().setFromRotationMatrix(matrix, 'YXZ');
    if ([angles.x, angles.y, angles.z].every(Number.isFinite)) rotation = { x: angles.x, y: angles.y, z: angles.z };
  }
  return { schemaVersion: 1, timestamp, faceDetected, rotation, channels,
    inferenceMs: Number.isFinite(inferenceMs) ? Math.max(0, inferenceMs) : 0 };
}

/** One outstanding frame, including asynchronous bitmap creation. Busy frames are dropped. */
export class FrameGate {
  private busy = false;
  private lastTimestamp = -Infinity;
  acquire(timestamp: number): boolean {
    if (this.busy || !Number.isFinite(timestamp) || timestamp <= this.lastTimestamp) return false;
    this.busy = true;
    this.lastTimestamp = timestamp;
    return true;
  }
  release(): void { this.busy = false; }
  reset(): void { this.busy = false; this.lastTimestamp = -Infinity; }
}
