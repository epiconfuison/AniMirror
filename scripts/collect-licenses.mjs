import { createRequire } from 'node:module';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const seen = new Set(), notices = [];
async function visit(name, from) {
  const req = createRequire(path.join(from, 'package.json'));
  let entry;
  try { entry = req.resolve(`${name}/package.json`); } catch { entry = req.resolve(name); }
  let directory = path.dirname(entry);
  let pkg;
  for (;;) {
    try { pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); } catch { pkg = undefined; }
    if (pkg?.name === name) break;
    const parent = path.dirname(directory); if (parent === directory) throw new Error(`Package metadata missing: ${name}`);
    directory = parent;
  }
  const key = `${pkg.name}@${pkg.version}`; if (seen.has(key)) return; seen.add(key);
  const licenseFiles = (await readdir(directory)).filter(n => /^(licen[sc]e|notice)(\.|$)/i.test(n));
  const content = [];
  for (const file of licenseFiles) content.push(await readFile(path.join(directory, file), 'utf8'));
  if (!content.length && pkg.license === 'Apache-2.0') {
    // The same standard Apache license text shipped with the pinned TypeScript dependency.
    content.push(await readFile(path.join(root, 'node_modules/typescript/LICENSE.txt'), 'utf8'));
    content.push('MediaPipe: Copyright Google LLC. Source: https://github.com/google-ai-edge/mediapipe');
  }
  if (!content.length) throw new Error(`License text missing: ${key}`);
  notices.push(`${key} (${pkg.license})\n${content.join('\n\n')}`);
  for (const child of Object.keys(pkg.dependencies ?? {})) await visit(child, directory);
}
for (const name of Object.keys(project.dependencies)) await visit(name, root);
// The Live2D Cubism SDK is vendored rather than installed as a package, and it is not
// covered by the dependency walk above.
const vendored = [
  ['Live2D Cubism SDK for Web', ['src/vendor/cubism/LICENSE.md']],
  ['Live2D Cubism Core (proprietary)', ['src/vendor/cubism/core/LICENSE.md', 'src/vendor/cubism/core/RedistributableFiles.txt']],
  ['Live2D Cubism Web Framework', ['src/vendor/cubism/framework/LICENSE.md']],
];
for (const [title, files] of vendored) {
  const content = [];
  for (const file of files) {
    try { content.push(await readFile(path.join(root, file), 'utf8')); } catch { /* SDK not vendored in this checkout */ }
  }
  if (content.length) notices.push(`${title}\n${content.join('\n\n')}`);
}
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public/THIRD_PARTY_LICENSES.txt'), 'AR-Capture runtime dependency notices\n\n' + notices.join('\n\n' + '='.repeat(72) + '\n\n'));
console.log(`Collected licenses for ${seen.size} runtime packages.`);
