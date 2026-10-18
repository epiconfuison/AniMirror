import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The Live2D SDK sample models are licensed by their authors and are not redistributed
 * with this repository, so the Live2D browser checks only run where the SDK samples are
 * present (locally, or with LIVE2D_SAMPLE_DIR pointing at a model folder).
 */
const sample = path.resolve(process.env.LIVE2D_SAMPLE_DIR ?? path.join('..', 'resource', 'CubismSdkForWeb-5-r.5', 'Samples', 'Resources', 'Hiyori'));
const available = existsSync(path.join(sample, 'Hiyori.model3.json'));

async function loadSample(page: import('@playwright/test').Page) {
  await page.getByLabel('导入 Live2D 模型').setInputFiles(sample);
  await expect(page.locator('.asset-info strong')).toHaveText('Hiyori', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('Live2D model import and driving', () => {
  test.skip(!available, '未提供 Live2D 示例模型（Cubism SDK Samples/Hiyori），跳过 Live2D 浏览器验收。');

  test('loads a model folder, reports real capabilities, saves and restores its own profile', async ({ page }) => {
    await page.goto('/');
    await loadSample(page);
    await expect(page.locator('.viewport canvas')).toHaveCount(1);
    await expect(page.locator('.capability-list')).toContainText('ParamAngleX');
    await expect(page.locator('.capability-list')).toContainText('ParamMouthOpenY');
    await expect(page.locator('.capability-list')).toContainText('ParamEyeLOpen');

    await page.getByRole('button', { name: '映射与调节', exact: true }).click();
    const mouth = page.locator('.mapping-rule').filter({ has: page.locator('select[aria-label^="目标表情"] option:checked', { hasText: 'ParamMouthOpenY' }) });
    await mouth.getByRole('button', { name: '试动', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止试动', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '停止试动', exact: true }).click();

    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.locator('.message[role="status"]')).toContainText('配置已保存');
    await page.reload();
    await loadSample(page);
    await expect(page.locator('.message[role="status"]')).toContainText('已按模型文件哈希恢复配置');
    await page.getByRole('button', { name: '映射与调节', exact: true }).click();
    expect(await page.locator('.mapping-rule').count()).toBeGreaterThan(0);
    await expect(page.locator('.mapping-rule').first()).toContainText('反向');
  });

  test('switches between Live2D and VRM without leaving a second canvas or a stale model', async ({ page }) => {
    await page.goto('/');
    await loadSample(page);
    await page.getByLabel('导入 VRM 模型').setInputFiles(path.resolve('tests/fixtures/diagnostic-vrm1-rich.vrm'));
    await expect(page.locator('.asset-info strong')).toHaveText('Mika · VRM 1 rich diagnostic');
    await expect(page.locator('.viewport canvas')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await loadSample(page);
    await expect(page.locator('.viewport canvas')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('keeps the working model after a failed import and explains what is wrong', async ({ page }) => {
    const invalid = path.resolve('.cache/live2d-invalid');
    mkdirSync(invalid, { recursive: true });
    writeFileSync(path.join(invalid, 'notes.json'), '{}');
    await page.goto('/');
    await loadSample(page);
    await page.getByLabel('导入 Live2D 模型').setInputFiles(invalid);
    await expect(page.getByRole('alert')).toContainText('.model3.json');
    await expect(page.locator('.asset-info strong')).toHaveText('Hiyori');
    await expect(page.locator('.viewport canvas')).toHaveCount(1);

    // A damaged manifest must fail loudly while the previous model keeps rendering.
    const broken = path.resolve('.cache/live2d-broken');
    mkdirSync(path.join(broken, 'model'), { recursive: true });
    writeFileSync(path.join(broken, 'model', 'Broken.model3.json'), '{"Version":2,"FileReferences":{}}');
    writeFileSync(path.join(broken, 'model', 'Broken.moc3'), 'not a moc');
    await page.getByLabel('导入 Live2D 模型').setInputFiles(broken);
    await expect(page.getByRole('alert')).toContainText('模型描述文件无效');
    await expect(page.locator('.asset-info strong')).toHaveText('Hiyori');
    await expect(page.locator('.viewport canvas')).toHaveCount(1);
  });

  test('survives a lost WebGL context and still switches models afterwards', async ({ page }) => {
    await page.goto('/');
    await loadSample(page);
    await page.evaluate(() => {
      const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
      const gl = (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')) as WebGLRenderingContext | null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await page.waitForTimeout(400);
    // The application must stay usable: the broken adapter is disposed when another model loads.
    await page.getByLabel('导入 VRM 模型').setInputFiles(path.resolve('tests/fixtures/diagnostic-vrm1-rich.vrm'));
    await expect(page.locator('.asset-info strong')).toHaveText('Mika · VRM 1 rich diagnostic');
    await expect(page.locator('.viewport canvas')).toHaveCount(1);
  });
});
