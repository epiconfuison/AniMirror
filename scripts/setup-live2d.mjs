import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Copies the licensed Live2D Cubism SDK for Web into the project in a reproducible way.
 *
 * Only `Core/live2dcubismcore*.js|d.ts` are listed by the Live2D Proprietary Software
 * License as redistributable; the Framework sources are vendored under the Live2D Open
 * Software License and stay inside this application. The generated lock file records
 * every copied byte so a rebuild can prove which SDK revision is embedded.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const sdkRoot = path.resolve(process.env.CUBISM_SDK_DIR ?? path.join(root, '../resource/CubismSdkForWeb-5-r.5'));
const vendor = path.join(root, 'src/vendor/cubism');
const publicVendor = path.join(root, 'public/vendor');
const lockPath = path.join(root, 'scripts/live2d-sdk.lock.json');
const check = process.argv.includes('--check');
const sha256 = data => createHash('sha256').update(data).digest('hex');

const exists = async target => { try { await stat(target); return true; } catch { return false; } };
const readJson = async target => JSON.parse(await readFile(target, 'utf8'));

async function walk(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), next));
    else files.push(next);
  }
  return files;
}

if (!await exists(sdkRoot)) {
  if (await exists(path.join(vendor, 'framework'))) {
    console.log(`未找到 SDK 源码目录 ${sdkRoot}，已保留现有 vendored 文件；仅校验锁文件。`);
    process.exit(0);
  }
  throw new Error(`未找到 Live2D Cubism SDK：${sdkRoot}\n请下载 CubismSdkForWeb-5-r.5 并放到该目录，或用 CUBISM_SDK_DIR 指定。`);
}

// Fail early when the SDK layout is not the official one.
await readJson(path.join(sdkRoot, 'Framework/package.json'));
// cubism-info.yml carries the SDK revision and the upstream Core/Framework commit hashes.
const info = await readFile(path.join(sdkRoot, 'cubism-info.yml'), 'utf8').catch(() => '');
const infoValue = key => info.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
const sdkVersion = infoValue('version') ?? path.basename(sdkRoot);
const sdkDirectory = path.basename(sdkRoot);
const copied = [];

async function copy(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  copied.push({ path: path.relative(root, to).replaceAll('\\', '/'), sha256: sha256(await readFile(to)) });
}

// Framework sources are compiled by this project; no prebuilt bundle is assumed.
// The SDK is written for a non-strict TypeScript project (its own tsconfig leaves
// strictNullChecks off), so the vendored copies carry @ts-nocheck and stay untouched
// otherwise; our own adapter is still type checked against them.
const VENDORED_HEADER = '// @ts-nocheck\n// Vendored Live2D Cubism SDK for Web - see ../../VENDOR.md. Do not edit.\n';
for (const file of await walk(path.join(sdkRoot, 'Framework/src'))) {
  const to = path.join(vendor, 'framework', file);
  await mkdir(path.dirname(to), { recursive: true });
  const source = await readFile(path.join(sdkRoot, 'Framework/src', file), 'utf8');
  const content = file.endsWith('.ts') && !source.startsWith('// @ts-nocheck') ? VENDORED_HEADER + source : source;
  await writeFile(to, content);
  copied.push({ path: path.relative(root, to).replaceAll('\\', '/'), sha256: sha256(Buffer.from(content)) });
}
for (const file of ['LICENSE.md', 'NOTICE.md', 'CHANGELOG.md', 'README.md']) {
  if (!await exists(path.join(sdkRoot, 'Framework', file))) continue;
  await copy(path.join(sdkRoot, 'Framework', file), path.join(vendor, 'framework', file));
}
// Core is the only part the licence explicitly allows to redistribute.
for (const file of ['live2dcubismcore.d.ts', 'live2dcubismcore.min.js', 'LICENSE.md', 'RedistributableFiles.txt', 'README.md', 'CHANGELOG.md']) {
  if (!await exists(path.join(sdkRoot, 'Core', file))) continue;
  await copy(path.join(sdkRoot, 'Core', file), path.join(vendor, 'core', file));
}
await copy(path.join(sdkRoot, 'Core/live2dcubismcore.min.js'), path.join(publicVendor, 'live2dcubismcore.min.js'));
// Cubism 5-r.x loads its shaders from files, so they must be published next to the app.
for (const file of await walk(path.join(sdkRoot, 'Framework/Shaders/WebGL'))) {
  await copy(path.join(sdkRoot, 'Framework/Shaders/WebGL', file), path.join(publicVendor, 'cubism-shaders', file));
}
for (const file of ['LICENSE.md', 'NOTICE.md']) {
  if (!await exists(path.join(sdkRoot, file))) continue;
  await copy(path.join(sdkRoot, file), path.join(vendor, file));
}
if (info) await copy(path.join(sdkRoot, 'cubism-info.yml'), path.join(vendor, 'cubism-info.yml'));
await writeFile(path.join(vendor, 'VENDOR.md'), [
  '# Vendored Live2D Cubism SDK for Web',
  '',
  `- SDK revision: \`${sdkVersion}\` (package directory \`${sdkDirectory}\`)`,
  `- Upstream Core commit: \`${infoValue('core') ?? 'unknown'}\``,
  `- Upstream Framework commit: \`${infoValue('framework') ?? 'unknown'}\``,
  `- Framework sources: \`framework/\` (copied from the SDK, prefixed with \`@ts-nocheck\`)`,
  `- Cubism Core: \`core/live2dcubismcore.min.js\`, also published at \`/vendor/live2dcubismcore.min.js\` and loaded as a classic script.`,
  '',
  '## Licences',
  '',
  '- Cubism Core: Live2D Proprietary Software License Agreement. Redistribution is limited to the files listed in `core/RedistributableFiles.txt`.',
  '- Cubism Web Framework and the included shaders: Live2D Open Software License Agreement. The sources stay inside this application; they are not published as a standalone SDK.',
  '- Models are licensed separately by their authors. This repository ships no Live2D model.',
  '',
  'Regenerate with `pnpm live2d:setup` (see `scripts/setup-live2d.mjs`); `scripts/live2d-sdk.lock.json` records every file hash.',
  '',
].join('\n'));

copied.sort((a, b) => a.path.localeCompare(b.path));
const record = { sdkVersion, sdkDirectory, coreCommit: infoValue('core'), frameworkCommit: infoValue('framework'), generatedAt: new Date().toISOString(), files: copied };

if (check) {
  const previous = await readJson(lockPath);
  const before = new Map(previous.files.map(file => [file.path, file.sha256]));
  const changed = copied.filter(file => before.get(file.path) !== file.sha256);
  if (changed.length) throw new Error(`vendored SDK 与锁文件不一致：${changed.map(file => file.path).join(', ')}`);
  console.log(`Cubism SDK ${sdkVersion} 与锁文件一致（${copied.length} 个文件）。`);
} else {
  await writeFile(lockPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`已复制 Cubism SDK ${sdkVersion}（${sdkDirectory}），共 ${copied.length} 个文件。`);
}
