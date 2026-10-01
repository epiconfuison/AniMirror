import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkOnly = process.argv.includes('--check');
const requiredTopFiles = new Set(['.gitignore', 'README.md', 'index.html', 'package.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'playwright.config.ts', 'tsconfig.json', 'vite.config.ts']);
const topFiles = new Set([...requiredTopFiles, 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'NOTICE', '.env.example']);
const sourceDirectories = ['.github', 'docs', 'progress', 'scripts', 'src', 'tests'];
const localOnly = new Set(['docs/SANDBOX_REPAIR.md', 'docs/ACCEPTANCE.md', 'docs/FINAL_TEST_GUIDE.md',
  'docs/final-test-templates', 'progress/00-workspace', 'progress/06-final-test-guide']);
const isLocalOnly = relative => [...localOnly].some(entry => relative === entry || relative.startsWith(`${entry}/`));
const originalModels = new Map([
  ['tests/fixtures/diagnostic-vrm0.vrm', '1ec92bb9d5004f88a77091a5f5e43b1b75aa58bd2668b0d940367c1f2113ecb2'],
  ['tests/fixtures/diagnostic-vrm1-rich.vrm', '0066a7756f11560bd1b38b9b31c4c2e8ec2bfa2b28b48aad764d2285f83e2893'],
  ['tests/fixtures/diagnostic-vrm1-minimal.vrm', 'b231f19fe96cbd6507f309f79ef1eb7f95cc3a05a70fca8ed656e5af7658f46a'],
]);
const secretRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['api-secret-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['literal-secret', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{24,}['"]/gi],
];
const forbidden = relative => (relative !== '.env.example' && /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials(?:\..*)?)$/i.test(relative))
  || /\.(?:pem|key|p12|pfx|har|heapsnapshot|mp4|webm|zip|task|wasm|tsbuildinfo|log|glb|gltf|fbx|blend|vroid)$/i.test(relative)
  || /(?:^|\/)(?:\.git|\.aws|\.codex|\.agents|node_modules|dist|\.cache|\.pnpm-store|models|user-models|local-data|final-test-results)(?:\/|$)/i.test(relative)
  || (/\.vrm$/i.test(relative) && !originalModels.has(relative));
const permitted = relative => !isLocalOnly(relative) && !forbidden(relative)
  && (topFiles.has(relative) || sourceDirectories.some(dir => relative.startsWith(`${dir}/`))
    || relative === 'public/THIRD_PARTY_LICENSES.txt');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Walk only source roots, never dependency/cache directories or symbolic links.
const candidates = new Set();
const ignoredLocalFiles = [];
async function collect(relative) {
  if (isLocalOnly(relative) || forbidden(relative)) { ignoredLocalFiles.push(relative); return; }
  const absolute = path.join(root, relative);
  let info;
  try { info = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not included: ${relative}`);
  if (info.isDirectory()) {
    for (const entry of await readdir(absolute)) await collect(`${relative}/${entry}`);
  } else if (info.isFile() && permitted(relative)) candidates.add(relative);
}
for (const relative of [...topFiles, ...sourceDirectories, 'public/THIRD_PARTY_LICENSES.txt']) await collect(relative);

// A tracked forbidden file must fail, rather than be silently hidden by .gitignore.
// ZIP downloads have no .git; the source walk and file checks still apply there.
let tracked = [];
if (await lstat(path.join(root, '.git')).catch(() => null)) {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}
const findings = tracked.filter(relative => forbidden(relative)).map(file => ({ file, rule: 'tracked-forbidden-file' }));
const files = [];
for (const relative of [...candidates].sort()) {
  const bytes = await readFile(path.join(root, relative));
  const hash = sha256(bytes);
  files.push({ path: relative, bytes: bytes.length, sha256: hash });
  if (originalModels.has(relative) && hash !== originalModels.get(relative)) findings.push({ file: relative, rule: 'unreviewed-model-bytes' });
  if (bytes.length > 10 * 1024 * 1024) findings.push({ file: relative, rule: 'unexpected-large-file' });
  if (bytes.includes(0)) continue; // Approved binary models and screenshots.
  const source = bytes.toString('utf8');
  for (const [rule, expression] of secretRules) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      findings.push({ file: relative, line: source.slice(0, match.index).split('\n').length, rule });
    }
  }
}
for (const required of [...requiredTopFiles, ...originalModels.keys(), 'tests/fixtures/LICENSE.md', 'public/THIRD_PARTY_LICENSES.txt', '.github/workflows/ci.yml']) {
  if (!candidates.has(required)) findings.push({ file: required, rule: 'missing-required-file' });
}
const report = {
  schemaVersion: 1,
  repository: 'https://github.com/epiconfuison/AniMirror',
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  findings,
  excludedLocalFiles: ignoredLocalFiles.sort(),
  checks: 'File boundaries, original model hashes, size and common secret patterns; no general license or secret guarantee.',
  files,
};
if (findings.length) {
  // Print locations and rule names only; never print a matched secret.
  console.error(JSON.stringify({ fileCount: files.length, findings }, null, 2));
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(JSON.stringify({ fileCount: report.fileCount, totalBytes: report.totalBytes, findings: [], excludedLocalFiles: report.excludedLocalFiles }, null, 2));
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(root, '.cache', 'github-upload', stamp);
  const stage = path.join(output, 'AniMirror');
  for (const file of files) {
    const destination = path.join(stage, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file.path), destination);
    if (sha256(await readFile(destination)) !== file.sha256) throw new Error(`File changed during preparation: ${file.path}`);
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ sourceDirectory: stage, manifest: path.join(output, 'manifest.json'), fileCount: report.fileCount, totalBytes: report.totalBytes, remoteChanged: false }, null, 2));
}
