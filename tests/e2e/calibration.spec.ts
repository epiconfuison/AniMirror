import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

// UI/persistence tests use known Worker parameters and a fake camera. They do not
// test MediaPipe inference, gesture accuracy, or real camera image quality.
test.use({ permissions: ['camera'], launchOptions: {
  executablePath: process.env.EDGE_EXECUTABLE ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
} });

const baseline = { eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05, jawOpen: 0.05, mouthSmileLeft: 0.05, mouthSmileRight: 0.05 };
type MockWindow = Window & { mockChannels: Record<string, number>; mockFrameCount: number };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(initial => {
    const host = window as unknown as MockWindow;
    host.mockChannels = initial; host.mockFrameCount = 0;
    class ParameterWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      closed = false;
      postMessage(message: { type: string; bitmap?: ImageBitmap; timestamp?: number }) {
        if (message.type === 'dispose') { this.closed = true; return; }
        if (message.type === 'frame') message.bitmap?.close();
        setTimeout(() => {
          if (this.closed) return;
          if (message.type === 'init') this.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
          if (message.type === 'frame') {
            host.mockFrameCount++;
            this.onmessage?.({ data: { type: 'result', timestamp: message.timestamp, inferenceMs: 3,
              result: {
                faceLandmarks: [Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))],
                faceBlendshapes: [{ categories: Object.entries(host.mockChannels).map(([categoryName, score]) => ({ categoryName, score })) }],
                facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
              },
            } } as MessageEvent);
          }
        }, 3);
      }
      terminate() { this.closed = true; }
    }
    window.Worker = ParameterWorker as unknown as typeof Worker;
  }, baseline);
});

async function exportJSON(page: Page, testInfo: TestInfo, button: string, file: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await downloadPromise, path = testInfo.outputPath(file);
  await download.saveAs(path);
  return { path, json: JSON.parse(await readFile(path, 'utf8')) };
}

test('four calibration steps save ranges, restore after reload, and stay cleared after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.getByText('追踪运行中', { exact: true })).toBeVisible();
  const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: '个人校准', exact: true }) });
  const steps = [
    { label: '中性脸', channels: baseline },
    { label: '闭眼', channels: { ...baseline, eyeBlinkLeft: 0.8, eyeBlinkRight: 0.75 } },
    { label: '张嘴', channels: { ...baseline, jawOpen: 0.85 } },
    { label: '微笑', channels: { ...baseline, mouthSmileLeft: 0.7, mouthSmileRight: 0.65 } },
  ];
  for (const step of steps) {
    await page.evaluate(channels => { (window as unknown as MockWindow).mockChannels = channels; }, step.channels);
    await panel.getByRole('button', { name: step.label, exact: true }).click();
    await panel.getByRole('button', { name: `采集${step.label}`, exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('本步已保存', { timeout: 7000 });
    await expect(panel.getByRole('button', { name: `✓ ${step.label}`, exact: true })).toBeVisible();
  }
  const exported = await exportJSON(page, testInfo, '导出 JSON', 'calibration.json');
  expect(exported.json.calibration.neutral.jawOpen).toBeCloseTo(0.05);
  const expectedRanges = { eyeBlinkLeft: 0.75, eyeBlinkRight: 0.7, jawOpen: 0.8, mouthSmileLeft: 0.65, mouthSmileRight: 0.6 };
  for (const [name, expected] of Object.entries(expectedRanges)) expect(exported.json.calibration.ranges[name]).toBeCloseTo(expected);
  for (const step of ['neutral', 'blink', 'mouth', 'smile']) expect(exported.json.calibration.quality[step]).toBeGreaterThan(0);

  await page.reload();
  for (const step of steps) await expect(panel.getByRole('button', { name: `✓ ${step.label}`, exact: true })).toBeVisible();
  const restored = await exportJSON(page, testInfo, '导出 JSON', 'restored.json');
  expect(restored.json.calibration).toEqual(exported.json.calibration);
  await page.getByRole('button', { name: '清除全部本地配置', exact: true }).click();
  await expect(page.locator('.message[role="status"]')).toContainText('已全部清除');
  await page.reload();
  await expect(panel.getByRole('button', { name: '重置个人校准', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '闭眼', exact: true })).toBeDisabled();
  const cleared = await exportJSON(page, testInfo, '导出 JSON', 'cleared.json');
  expect(cleared.json.calibration).toBeUndefined();
});

test('records named parameters, imports a round trip and exits fixed-clock replay when settings change', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('导入 VRM 模型', { exact: true }).setInputFiles(resolve('tests/fixtures/diagnostic-vrm1-rich.vrm'));
  await expect(page.locator('.asset-info strong')).toHaveText('Mika · VRM 1 rich diagnostic');
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.getByText('追踪运行中', { exact: true })).toBeVisible();
  await page.locator('.diagnostics summary').click();
  await page.getByRole('button', { name: '录制参数 · 最多30秒', exact: true }).click();
  const before = await page.evaluate(() => (window as unknown as MockWindow).mockFrameCount);
  await expect.poll(() => page.evaluate(() => (window as unknown as MockWindow).mockFrameCount), { timeout: 7000 }).toBeGreaterThan(before + 45);
  await page.getByRole('button', { name: '停止录制', exact: true }).click();
  const exported = await exportJSON(page, testInfo, '导出参数', 'recording.json');
  expect(exported.json.frames.length).toBeGreaterThan(40);
  expect(exported.json.durationMs).toBeGreaterThan(1000);
  for (const [index, frame] of exported.json.frames.entries()) {
    expect(frame.faceDetected).toBe(true);
    expect(frame.channels.jawOpen).toBe(0.05);
    expect(frame.timestamp).toBeGreaterThan(index ? exported.json.frames[index - 1].timestamp : -1);
    expect(Object.keys(frame).sort()).toEqual(['channels', 'faceDetected', 'inferenceMs', 'rotation', 'schemaVersion', 'timestamp']);
  }
  await page.getByLabel('导入参数录制').setInputFiles(exported.path);
  await expect(page.locator('.diagnostics')).toContainText('固定60Hz虚拟时钟回放');
  const roundTrip = await exportJSON(page, testInfo, '导出参数', 'recording-roundtrip.json');
  expect(roundTrip.json).toEqual(exported.json);

  await page.getByRole('button', { name: '回放', exact: true }).click();
  await expect(page.locator('.viewport-top')).toContainText('参数回放');
  await expect(page.getByText('已暂停 · 摄像头保持连接', { exact: true })).toBeVisible();
  await page.getByLabel('风格预设').selectOption('enhanced');
  await expect(page.getByRole('button', { name: '停止回放', exact: true })).toHaveCount(0);
  await expect(page.locator('.viewport-top')).not.toContainText('参数回放');
  await page.getByRole('button', { name: '映射与调节', exact: true }).click();
  await page.getByRole('button', { name: '回放', exact: true }).click();
  await expect(page.locator('.viewport-top')).toContainText('参数回放');
  await page.getByRole('button', { name: '试动', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '停止回放', exact: true })).toHaveCount(0);
  await expect(page.locator('.viewport-top')).not.toContainText('参数回放');
  await page.getByRole('button', { name: '驱动与校准', exact: true }).click();
  await page.getByRole('button', { name: '回放', exact: true }).click();
  await expect(page.locator('.viewport-top')).toContainText('参数回放');
  await expect(page.getByRole('button', { name: '回放', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.viewport-top')).not.toContainText('参数回放');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
