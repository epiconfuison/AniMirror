import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const dest = path.join(root, 'public/tracking-assets');
const pkg = path.join(root, 'node_modules/@mediapipe/tasks-vision');
const source = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const sha = data => createHash('sha256').update(data).digest('hex');
const lockPath = path.join(root, 'scripts/tracking-assets.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const installed = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8'));
if (installed.version !== lock.version) throw new Error('MediaPipe 版本与资源锁不一致，请使用项目锁文件安装依赖。');
await mkdir(path.join(dest, 'wasm'), { recursive: true });
await copyFile(path.join(pkg, 'vision_bundle.mjs'), path.join(dest, 'vision_bundle.mjs'));
const names = (await readdir(path.join(pkg, 'wasm'))).filter(name => /\.(wasm|js)$/.test(name));
for (const name of names) await copyFile(path.join(pkg, 'wasm', name), path.join(dest, 'wasm', name));
let data;
try { data = await readFile(path.join(dest, 'face_landmarker.task')); } catch { /* first install */ }
if (!data || (lock.modelSha256 && sha(data) !== lock.modelSha256)) {
  console.log('下载固定版本 Face Landmarker 模型（约 3.6 MB）…');
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (data.length < 1000000 || data.length > 10000000 || (lock.modelSha256 && sha(data) !== lock.modelSha256)) throw new Error('模型资源校验失败。');
await writeFile(path.join(dest, 'face_landmarker.task'), data);
const files = [];
for (const name of ['face_landmarker.task', 'vision_bundle.mjs', ...names.map(n => `wasm/${n}`)]) {
  const bytes = await readFile(path.join(dest, name));
  files.push({ name, bytes: bytes.length, sha256: sha(bytes) });
}
await writeFile(path.join(dest, 'manifest.json'), JSON.stringify({ version: installed.version, source, files }, null, 2));
console.log(JSON.stringify({ modelSha256: sha(data), totalMB: files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024 }));
