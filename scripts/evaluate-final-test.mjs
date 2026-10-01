import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createServer } from 'vite';
const [configFile, recordingFile, outputPrefix = '.cache/final-tests/replay-analysis', startSeconds = '1', endSeconds] = process.argv.slice(2);
if (!configFile || !recordingFile) {
  console.error('Usage: node scripts/evaluate-final-test.mjs CONFIG.json RECORDING.json [OUTPUT_PREFIX] [START_SECONDS=1] [END_SECONDS=clip end]');
  process.exit(1);
}
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', clearScreen: false });
try {
  const profiles = await server.ssrLoadModule('/src/core/profiles/index.ts');
  const recordings = await server.ssrLoadModule('/src/features/diagnostics/recording.ts');
  const evaluator = await server.ssrLoadModule('/src/features/diagnostics/evaluation.ts');
  const configText = await readFile(configFile, 'utf8'), recordingText = await readFile(recordingFile, 'utf8');
  const bundle = profiles.parseBundle(configText), recording = recordings.parseRecording(recordingText);
  if (!bundle.model) throw new Error('配置必须包含模型映射；请在导入模型并完成校准后导出 JSON。');
  const comparison = evaluator.compareRecording(recording, bundle.model, bundle.calibration, Number(startSeconds) * 1000, endSeconds === undefined ? recording.durationMs : Number(endSeconds) * 1000);
  const targets = Object.keys(comparison.summary.expressions);
  const columns = ['timestampMs', 'tracking', ...['x','y','z'].flatMap(axis => [`baseline.head.${axis}`, `selected.head.${axis}`]), ...targets.flatMap(target => [`baseline.expression.${target}`, `selected.expression.${target}`])];
  const cell = value => '"' + String(value).replaceAll('"', '""') + '"';
  const lines = [columns.map(cell).join(',')];
  comparison.selected.forEach((output, index) => {
    const baseline = comparison.baseline[index];
    lines.push([index * 1000 / 60, output.tracking, ...['x','y','z'].flatMap(axis => [baseline.rotation[axis], output.rotation[axis]]), ...targets.flatMap(target => [baseline.expressions[target] ?? 0, output.expressions[target] ?? 0])].map(cell).join(','));
  });
  const sha = text => createHash('sha256').update(text).digest('hex');
  const report = { ...comparison.summary, sourceSha256: { config: sha(configText), recording: sha(recordingText) },
    notes: ['Recording format contains no model hash; use the matching configuration from the same test session.', 'The tool cannot decide whether the person was still or whether an avatar visibly performed the correct action.'] };
  await mkdir(path.dirname(outputPrefix), { recursive: true });
  await writeFile(outputPrefix + '.json', JSON.stringify(report, null, 2));
  await writeFile(outputPrefix + '.csv', lines.join('\n'));
  console.log(JSON.stringify({ report: outputPrefix + '.json', frameValues: outputPrefix + '.csv', headCombined: report.headCombined, validSamples: report.validSamples, excludedNonLiveSamples: report.excludedNonLiveSamples }, null, 2));
} finally { await server.close(); }
