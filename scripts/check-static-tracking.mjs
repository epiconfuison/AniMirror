import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Optional, separately downloaded positive input. No image is bundled or uploaded.
// Run after assets:setup; see progress/02-tracking/STATIC_CHECK.md for provenance.
const imagePath = resolve(process.argv[2] ?? '.cache/static-tracking/portrait.jpg');
const bytes = await readFile(imagePath);
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('public/tracking-assets/manifest.json', 'utf8'));
const externalRequests = [], pageErrors = [];
const server = await createServer({ server: { host: '127.0.0.1', port: 5184, strictPort: true } });
server.middlewares.use('/static-check', (_req, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><html lang="en"><title>Local tracking technical check</title><body>Static bitmap check</body></html>');
});
let browser;
try {
  await server.listen();
  const origin = 'http://127.0.0.1:5184';
  browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_EXECUTABLE ??
    (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin) {
      externalRequests.push(url); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/static-check`);
  const frames = await page.evaluate(async encoded => {
    const { toTrackingFrame } = await import('/src/core/tracking/result.ts');
    // Match CameraController's classic Worker URL after Vite development transform.
    // A ?worker default import uses a module Worker in dev, incompatible with importScripts.
    const worker = new Worker('/src/core/tracking/face.worker.ts?worker_file&type=classic');
    const blob = new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/jpeg' });
    const results = [];
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Worker positive result timed out')), 45000);
        worker.onerror = event => reject(new Error(event.message));
        const submit = async () => {
          const bitmap = await createImageBitmap(blob);
          worker.postMessage({ type: 'frame', bitmap, timestamp: 1000 + results.length * 100 }, [bitmap]);
        };
        worker.onmessage = async event => {
          try {
            const message = event.data;
            if (message.type === 'error') throw new Error(message.message);
            if (message.type === 'ready') await submit();
            if (message.type === 'result') {
              const frame = toTrackingFrame(message.result, message.timestamp, message.inferenceMs);
              results.push({
                faceCount: message.result.faceLandmarks.length,
                landmarkCount: message.result.faceLandmarks[0]?.length ?? 0,
                matrixLength: message.result.facialTransformationMatrixes[0]?.data.length ?? 0,
                rawCategoryCount: message.result.faceBlendshapes[0]?.categories.length ?? 0,
                channelCount: Object.keys(frame.channels).length,
                frame,
              });
              if (results.length === 3) resolve(results); else await submit();
            }
          } catch (error) { reject(error); }
        };
        worker.postMessage({ type: 'init', assetsBase: `${location.origin}/tracking-assets/` });
      });
    } finally {
      clearTimeout(timer);
      worker.postMessage({ type: 'dispose' });
      worker.terminate();
    }
  }, bytes.toString('base64'));
  assert.equal(frames.length, 3);
  for (const result of frames) {
    assert.equal(result.faceCount, 1);
    assert.ok(result.landmarkCount >= 468);
    assert.equal(result.matrixLength, 16);
    assert.equal(result.frame.faceDetected, true);
    for (const channel of ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'mouthSmileLeft', 'mouthSmileRight']) {
      assert.ok(Number.isFinite(result.frame.channels[channel]), `Missing channel ${channel}`);
    }
    assert.ok(Object.values(result.frame.rotation).every(Number.isFinite));
  }
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);
  const report = {
    checkedAt: new Date().toISOString(), browser: browser.version(), node: process.version,
    sourceSha256, sourceBytes: bytes.length, delegate: 'CPU', runningMode: 'VIDEO',
    mediaPipeVersion: manifest.version,
    modelSha256: manifest.files.find(file => file.name === 'face_landmarker.task')?.sha256,
    description: 'Three repeated static bitmaps; not live camera, gesture accuracy, latency or sustained performance acceptance.',
    externalRequests, pageErrors, frames,
  };
  await mkdir('.cache/static-tracking', { recursive: true });
  await writeFile('.cache/static-tracking/result.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, frames: frames.map(({ frame, ...counts }) => ({ ...counts,
    timestamp: frame.timestamp, inferenceMs: frame.inferenceMs, rotation: frame.rotation,
    jawOpen: frame.channels.jawOpen, eyeBlinkLeft: frame.channels.eyeBlinkLeft, eyeBlinkRight: frame.channels.eyeBlinkRight,
  })) }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
