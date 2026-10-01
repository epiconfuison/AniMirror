/** Original procedural assets, released under CC0-1.0. No downloaded model data. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');
await mkdir(out, { recursive: true });

function createFixture(version, rich, name) {
  const chunks = [], bufferViews = [], accessors = [], meshes = [], nodes = [];
  let byteLength = 0;
  const accessor = (values, type, componentType = 5126) => {
    const data = componentType === 5126 ? new Float32Array(values) : new Uint16Array(values);
    const bytes = Buffer.from(data.buffer);
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    chunks.push(bytes);
    const padding = (4 - bytes.length % 4) % 4;
    if (padding) chunks.push(Buffer.alloc(padding));
    byteLength += bytes.length + padding;
    const width = type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 1;
    const min = new Array(width).fill(Infinity), max = new Array(width).fill(-Infinity);
    values.forEach((v, i) => { min[i % width] = Math.min(min[i % width], v); max[i % width] = Math.max(max[i % width], v); });
    accessors.push({ bufferView: view, componentType, type, count: values.length / width, min, max });
    return accessors.length - 1;
  };
  const materialColors = [[0.94, 0.7, 0.51, 1], [0.055, 0.38, 0.36, 1], [0.13, 0.18, 0.25, 1], [1, 1, 1, 1], [0.13, 0.23, 0.27, 1]];
  const addNode = (name, translation, parent) => {
    const index = nodes.length;
    nodes.push({ name, translation, children: [] });
    if (parent !== undefined) nodes[parent].children.push(index);
    return index;
  };
  const root = addNode('DiagnosticAvatarRoot', [0, 0, 0]);
  if (version === '0') nodes[root].rotation = [0, 1, 0, 0]; // VRM0 convention: face -Z before normalization.
  const humanBones = {};
  const bone = (name, translation, parent) => humanBones[name] = { node: addNode(name, translation, parent) };
  const hips = bone('hips', [0, 0.82, 0], root).node;
  const spine = bone('spine', [0, 0.15, 0], hips).node;
  const chest = bone('chest', [0, 0.22, 0], spine).node;
  const neck = bone('neck', [0, 0.2, 0], chest).node;
  const head = bone('head', [0, 0.07, 0], neck).node;
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const upperLeg = bone(`${side}UpperLeg`, [sign * 0.09, -0.04, 0], hips).node;
    const lowerLeg = bone(`${side}LowerLeg`, [0, -0.35, 0], upperLeg).node;
    bone(`${side}Foot`, [0, -0.35, 0.04], lowerLeg);
    const shoulder = bone(`${side}Shoulder`, [sign * 0.12, 0.14, 0], chest).node;
    const upperArm = bone(`${side}UpperArm`, [sign * 0.08, 0, 0], shoulder).node;
    const lowerArm = bone(`${side}LowerArm`, [sign * 0.26, 0, 0], upperArm).node;
    bone(`${side}Hand`, [sign * 0.23, 0, 0], lowerArm);
    if (rich) bone(`${side}Eye`, [sign * 0.067, 0.12, 0.15], head);
  }
  const addGeometry = (geometry, parent, material, name, translation = [0, 0, 0]) => {
    const primitive = { attributes: { POSITION: accessor([...geometry.attributes.position.array], 'VEC3'), NORMAL: accessor([...geometry.attributes.normal.array], 'VEC3') }, material };
    if (geometry.index) primitive.indices = accessor([...geometry.index.array], 'SCALAR', 5123);
    const mesh = meshes.length;
    meshes.push({ name, primitives: [primitive] });
    const node = addNode(name, translation, parent);
    nodes[node].mesh = mesh;
    geometry.dispose();
    return { node, mesh, primitive };
  };
  addGeometry(new BoxGeometry(0.34, 0.44, 0.19), spine, 1, 'Jacket', [0, 0.15, 0]);
  addGeometry(new CylinderGeometry(0.045, 0.052, 0.14, 12), neck, 0, 'Neck', [0, -0.025, 0]);
  addGeometry(new SphereGeometry(0.1, 12, 8).scale(1.7, 1, 1.1), hips, 2, 'Hips');
  addGeometry(new SphereGeometry(0.16, 20, 16).scale(0.96, 1.18, 0.98), head, 0, 'Head', [0, 0.11, 0]);
  addGeometry(new SphereGeometry(0.163, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.36).scale(1, 1.2, 1.015), head, 4, 'HairCap', [0, 0.12, -0.009]);
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    addGeometry(new SphereGeometry(0.055, 12, 8), chest, 1, `${side}ShoulderShape`, [sign * 0.18, 0.14, 0]);
    addGeometry(new BoxGeometry(0.25, 0.075, 0.08), humanBones[`${side}UpperArm`].node, 1, `${side}Sleeve`, [sign * 0.12, 0, 0]);
    addGeometry(new BoxGeometry(0.22, 0.065, 0.07), humanBones[`${side}LowerArm`].node, 0, `${side}Forearm`, [sign * 0.11, 0, 0]);
    addGeometry(new SphereGeometry(0.04, 8, 8), humanBones[`${side}Hand`].node, 0, `${side}Palm`, [sign * 0.025, 0, 0]);
    addGeometry(new BoxGeometry(0.1, 0.34, 0.12), humanBones[`${side}UpperLeg`].node, 2, `${side}Thigh`, [0, -0.17, 0]);
    addGeometry(new BoxGeometry(0.08, 0.34, 0.1), humanBones[`${side}LowerLeg`].node, 2, `${side}Calf`, [0, -0.17, 0]);
    addGeometry(new BoxGeometry(0.105, 0.07, 0.17), humanBones[`${side}Foot`].node, 4, `${side}Shoe`, [0, -0.025, 0.045]);
  }
  // One colored face mesh keeps all independent morph targets inspectable in one place.
  const positions = [], normals = [], colors = [], labels = [];
  const feature = (label, center, scale, color) => {
    const geometry = new SphereGeometry(1, 12, 8).scale(...scale).translate(...center).toNonIndexed();
    positions.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    for (let i = 0; i < geometry.attributes.position.count; i++) { colors.push(...color); labels.push({ label, center }); }
    geometry.dispose();
  };
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    feature(`eye${side}`, [sign * 0.064, 0.14, 0.145], [0.039, 0.038, 0.018], [0.98, 0.99, 1]);
    feature(`iris${side}`, [sign * 0.064, 0.14, 0.161], [0.023, 0.028, 0.009], [0.028, 0.08, 0.095]);
    feature(`brow${side}`, [sign * 0.067, 0.197, 0.14], [0.043, 0.007, 0.012], [0.08, 0.11, 0.14]);
  }
  feature('mouth', [0, 0.047, 0.15], [0.047, 0.009, 0.012], [0.22, 0.035, 0.05]);
  const names = rich ? ['blinkLeft', 'blinkRight', 'aa', 'happy', 'browInnerUp', 'browDownLeft', 'browDownRight', 'mouthSmileLeft', 'mouthSmileRight', 'lookLeft', 'lookRight', 'lookUp', 'lookDown'] : [];
  const targets = names.map(name => {
    const deltas = new Array(positions.length).fill(0);
    for (let i = 0; i < labels.length; i++) {
      const { label, center } = labels[i];
      const x = positions[i * 3], y = positions[i * 3 + 1];
      if (name.startsWith('blink') && (label === `eye${name.slice(5)}` || label === `iris${name.slice(5)}`)) deltas[i * 3 + 1] = -(y - center[1]) * 0.94;
      if (name === 'aa' && label === 'mouth') deltas[i * 3 + 1] = (y - center[1]) * 4.5 - 0.01;
      if (label === 'mouth' && (name === 'happy' || (name === 'mouthSmileLeft' && x > 0) || (name === 'mouthSmileRight' && x < 0))) deltas[i * 3 + 1] = Math.abs(x) * 0.38;
      if (name === 'browInnerUp' && label.startsWith('brow')) deltas[i * 3 + 1] = 0.018 * (1 - Math.abs(x) / 0.14);
      if (name.startsWith('browDown') && label === `brow${name.slice(8)}`) deltas[i * 3 + 1] = -0.02;
      if (name.startsWith('look') && label.startsWith('iris')) {
        if (name === 'lookLeft') deltas[i * 3] = 0.012;
        if (name === 'lookRight') deltas[i * 3] = -0.012;
        if (name === 'lookUp') deltas[i * 3 + 1] = 0.012;
        if (name === 'lookDown') deltas[i * 3 + 1] = -0.012;
      }
    }
    return { POSITION: accessor(deltas, 'VEC3') };
  });
  const faceMesh = meshes.length;
  const primitive = { attributes: { POSITION: accessor(positions, 'VEC3'), NORMAL: accessor(normals, 'VEC3'), COLOR_0: accessor(colors, 'VEC3') }, material: 3 };
  if (names.length) primitive.targets = targets;
  meshes.push({ name: 'Face', primitives: [primitive], ...(names.length ? { weights: names.map(() => 0), extras: { targetNames: names } } : {}) });
  const faceNode = addNode('Face', [0, 0, 0], head);
  nodes[faceNode].mesh = faceMesh;
  const presetNames = new Set(['blinkLeft', 'blinkRight', 'aa', 'happy', 'lookLeft', 'lookRight', 'lookUp', 'lookDown']);
  const expressions = { preset: {}, custom: {} };
  names.forEach((name, index) => expressions[presetNames.has(name) ? 'preset' : 'custom'][name] = { morphTargetBinds: [{ node: faceNode, index, weight: 1 }], isBinary: false, overrideBlink: 'none', overrideMouth: 'none', overrideLookAt: 'none' });
  const vrm1 = {
    specVersion: '1.0',
    meta: { name, version: '1.0', authors: ['AR-Capture contributors'], copyrightInformation: 'Original procedural diagnostic asset; CC0-1.0', licenseUrl: 'https://vrm.dev/licenses/1.0/', otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', avatarPermission: 'everyone', allowExcessivelyViolentUsage: true, allowExcessivelySexualUsage: true, commercialUsage: 'corporation', allowPoliticalOrReligiousUsage: true, allowAntisocialOrHateUsage: true, creditNotation: 'unnecessary', allowRedistribution: true, modification: 'allowModificationRedistribution' },
    humanoid: { humanBones }, expressions,
    firstPerson: { meshAnnotations: [] },
  };
  const legacy = { blinkLeft: 'blink_l', blinkRight: 'blink_r', aa: 'a', happy: 'joy', lookLeft: 'lookleft', lookRight: 'lookright', lookUp: 'lookup', lookDown: 'lookdown' };
  const vrm0 = {
    exporterVersion: 'AR-Capture procedural fixture 1', specVersion: '0.0',
    meta: { title: name, version: '1.0', author: 'AR-Capture contributors', allowedUserName: 'Everyone', violentUssageName: 'Allow', sexualUssageName: 'Allow', commercialUssageName: 'Allow', licenseName: 'CC0', texture: -1 },
    humanoid: { humanBones: Object.entries(humanBones).map(([bone, value]) => ({ bone, ...value, useDefaultValues: true })) },
    firstPerson: { firstPersonBone: head, firstPersonBoneOffset: { x: 0, y: 0.1, z: 0 }, meshAnnotations: [], lookAtTypeName: 'Bone', ...Object.fromEntries(['lookAtHorizontalInner', 'lookAtHorizontalOuter', 'lookAtVerticalDown', 'lookAtVerticalUp'].map(key => [key, { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 }])) },
    blendShapeMaster: { blendShapeGroups: names.map((name, index) => ({ name, presetName: legacy[name] ?? 'unknown', binds: [{ mesh: faceMesh, index, weight: 100 }], materialValues: [], isBinary: false })) },
    secondaryAnimation: { boneGroups: [], colliderGroups: [] }, materialProperties: [],
  };
  const extension = version === '1' ? 'VRMC_vrm' : 'VRM';
  const json = { asset: { version: '2.0', generator: 'AR-Capture original procedural fixtures' }, extensionsUsed: [extension], extensions: { [extension]: version === '1' ? vrm1 : vrm0 }, scene: 0, scenes: [{ nodes: [root] }], nodes, meshes, materials: materialColors.map((baseColorFactor, index) => ({ name: `DiagnosticMaterial${index}`, pbrMetallicRoughness: { baseColorFactor, metallicFactor: 0, roughnessFactor: 0.9 } })), accessors, bufferViews, buffers: [{ byteLength }] };
  const jsonText = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.concat([jsonText, Buffer.alloc((4 - jsonText.length % 4) % 4, 0x20)]);
  const binBytes = Buffer.concat(chunks);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binBytes.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]);
}

for (const [file, version, rich, name] of [
  ['diagnostic-vrm0.vrm', '0', true, 'Mika · VRM 0 diagnostic'],
  ['diagnostic-vrm1-rich.vrm', '1', true, 'Mika · VRM 1 rich diagnostic'],
  ['diagnostic-vrm1-minimal.vrm', '1', false, 'Mika · VRM 1 missing channels'],
]) {
  const bytes = createFixture(version, rich, name);
  await writeFile(resolve(out, file), bytes);
  console.log(`${file}: ${bytes.length} bytes`);
}
