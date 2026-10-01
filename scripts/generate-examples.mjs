import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const bytes = await readFile(new URL('../tests/fixtures/diagnostic-vrm1-rich.vrm', import.meta.url));
const config = { schemaVersion: 1, model: { schemaVersion: 1, modelHash: createHash('sha256').update(bytes).digest('hex'), modelName: 'Mika · VRM 1 rich diagnostic',
  mappings: [['eyeBlinkLeft','blinkLeft',1,false],['eyeBlinkRight','blinkRight',1,false],['jawOpen','aa',1,false],['mouthSmileLeft','happy',.5,true],['mouthSmileRight','happy',.5,true]].map(([input,target,weight,approximate]) => ({ id: `${input}:${target}`, input, target, weight, enabled: true, approximate, confirmed: !approximate })),
  tuning: {}, headLimits: { x: Math.PI/4, y: Math.PI/3, z: Math.PI/5 }, headGain: 1, smoothing: .5, style: 'natural', eyeMode: 'expression' },
  ui: { schemaVersion: 1, background: '#dce9e5', framing: 'half', mirror: true, showVideo: true } };
await writeFile(new URL('../tests/fixtures/example-config.json', import.meta.url), JSON.stringify(config, null, 2));
const frames = [];
for (let i = 0; i <= 240; i++) {
  const t = i / 30, faceDetected = !(t > 5 && t < 7);
  frames.push({ schemaVersion: 1, timestamp: i * 1000/30, faceDetected, inferenceMs: 0,
    rotation: { x: .12*Math.sin(t*2), y: .3*Math.sin(t), z: .08*Math.sin(t*1.4) },
    channels: { eyeBlinkLeft: i % 50 < 3 ? .95 : .02, eyeBlinkRight: i % 70 < 3 ? .95 : .02, jawOpen: Math.max(0, Math.sin(t*3))*.8, mouthSmileLeft: .4, mouthSmileRight: .4 } });
}
await writeFile(new URL('../tests/fixtures/synthetic-face-sequence.json', import.meta.url), JSON.stringify({ schemaVersion: 1, durationMs: 8000, frames }, null, 2));
console.log('Generated model-bound configuration and 8-second synthetic motion example; no personal calibration or camera data.');
