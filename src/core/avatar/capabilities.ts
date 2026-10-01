import { Mesh } from 'three';
import { VRMExpressionMorphTargetBind, type VRM } from '@pixiv/three-vrm';
import type { AvatarCapabilities } from '../contracts';

export function inspectAvatar(vrm: VRM, version: '0' | '1', fallbackName: string): AvatarCapabilities {
  const manager = vrm.expressionManager;
  const presets = new Set(Object.keys(manager?.presetExpressionMap ?? {}));
  const expressions = (manager?.expressions ?? []).map(expression => ({
    name: expression.expressionName,
    preset: presets.has(expression.expressionName),
    bindCount: expression.binds.filter(bind => {
      if (bind instanceof VRMExpressionMorphTargetBind) {
        if (!Number.isFinite(bind.weight) || bind.weight === 0) return false;
        return bind.primitives.some(primitive => (['position', 'normal', 'color'] as const).some(attribute => {
          const morph = primitive.geometry.morphAttributes[attribute]?.[bind.index];
          if (!morph) return false;
          // A named but all-zero target cannot drive the avatar.
          const base = primitive.geometry.attributes[attribute];
          for (let i = 0; i < morph.count; i++) for (let c = 0; c < morph.itemSize; c++) {
            const value = morph.getComponent(i, c);
            if (Number.isFinite(value) && Math.abs(value - (primitive.geometry.morphTargetsRelative ? 0 : base?.getComponent(i, c) ?? 0)) > 1e-7) return true;
          }
          return false;
        }));
      }
      const weighted = bind as { weight?: number };
      return weighted.weight === undefined || weighted.weight !== 0;
    }).length,
    isBinary: expression.isBinary,
    overrideBlink: expression.overrideBlink,
    overrideMouth: expression.overrideMouth,
    overrideLookAt: expression.overrideLookAt,
  }));
  const morphTargets: string[] = [];
  let vertexCount = 0;
  vrm.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    vertexCount += node.geometry.attributes.position?.count ?? 0;
    for (const [name, index] of Object.entries(node.morphTargetDictionary ?? {})) {
      if (node.geometry.morphAttributes.position?.[index] || node.geometry.morphAttributes.normal?.[index]) morphTargets.push(`${node.name || 'Mesh'} / ${name}`);
    }
  });
  const bones = {
    head: !!vrm.humanoid.getNormalizedBoneNode('head'),
    leftEye: !!vrm.humanoid.getNormalizedBoneNode('leftEye'),
    rightEye: !!vrm.humanoid.getNormalizedBoneNode('rightEye'),
  };
  const usable = expressions.filter(expression => expression.bindCount > 0).map(expression => expression.name.toLowerCase().replace(/[_ -]/g, ''));
  const has = (...names: string[]) => names.some(name => usable.includes(name.toLowerCase()));
  const blink = has('blink') || (has('blinkLeft', 'eyeBlinkLeft') && has('blinkRight', 'eyeBlinkRight'));
  const mouth = has('aa', 'a', 'jawOpen', 'mouthOpen');
  const smile = has('happy', 'joy', 'mouthSmileLeft', 'mouthSmileRight', 'smile');
  const missing = [
    ...(!bones.head ? ['头部骨骼不可用'] : []),
    ...(!blink ? ['缺少完整眨眼表情；请检查左右眼映射'] : []),
    ...(!mouth ? ['缺少已识别的张嘴表情'] : []),
    ...(!smile ? ['缺少已识别的微笑表情'] : []),
    ...(!bones.leftEye || !bones.rightEye ? ['眼睛骨骼不完整；视线仅能使用已有表情'] : []),
    ...expressions.filter(expression => !expression.bindCount).map(expression => `${expression.name} 未绑定有效形变或材质`),
  ];
  const meta = vrm.meta as unknown as { name?: string; title?: string } | undefined;
  return {
    version, name: meta?.name || meta?.title || fallbackName,
    bones, expressions, morphTargets, missing,
    level: blink && mouth ? (usable.length >= 8 && has('browInnerUp', 'browOuterUpLeft', 'browDownLeft') ? 'rich' : 'face') : 'basic',
    vertexCount,
  };
}
