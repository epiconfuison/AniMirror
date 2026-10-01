import { Euler, Quaternion } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { DriveOutput } from '../contracts';

/** Convert application forward +Z to each imported normalized humanoid's frame. */
export class AvatarDriver {
  private readonly headRest = new Quaternion();
  private readonly headDelta = new Quaternion();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private readonly legacyAxis: number;

  constructor(private readonly vrm: VRM) {
    this.headRest.copy(vrm.humanoid.getNormalizedBoneNode('head')?.quaternion ?? new Quaternion());
    // rotateVRM0 turns the scene after the normalized rig was created. Its X/Z
    // axes therefore need a sign change, while yaw around Y remains unchanged.
    this.legacyAxis = vrm.meta.metaVersion === '0' ? -1 : 1;
  }

  apply(output: DriveOutput): void {
    const finite = (value: number) => Number.isFinite(value) ? value : 0;
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      this.rotation.set(this.legacyAxis * finite(output.rotation.x), finite(output.rotation.y), this.legacyAxis * finite(output.rotation.z), 'YXZ');
      head.quaternion.copy(this.headRest).multiply(this.headDelta.setFromEuler(this.rotation));
    }
    // Reset omitted channels, write each target once, and let VRM resolve overrides.
    for (const expression of this.vrm.expressionManager?.expressions ?? []) {
      this.vrm.expressionManager!.setValue(expression.expressionName, Math.max(0, Math.min(1, finite(output.expressions[expression.expressionName] ?? 0))));
    }
  }
}
