import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const fixture = (name: string) => resolve('tests/fixtures', name);
const screenshots = resolve('.cache/screenshots');

async function captureEvidence(page: Page, name: string) {
  // These captures document local visual checks; they are not image assertions.
  // CI keeps failure screenshots/traces and avoids captures during 1.5s trials.
  if (!process.env.CI) await page.screenshot({ path: resolve(screenshots, name), fullPage: true });
}

async function settleFrame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function importModel(page: Page, file: string, name: string) {
  await page.getByLabel('导入 VRM 模型', { exact: true }).setInputFiles(fixture(file));
  await expect(page.locator('.asset-info strong')).toHaveText(name);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await settleFrame(page);
}

test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });

test('three model fixtures, framing, independent expression trial and safe failed replacement', async ({ page }) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('你的角色，即将登场')).toBeVisible();
  await captureEvidence(page, 'studio-empty.png');

  await importModel(page, 'diagnostic-vrm1-rich.vrm', 'Mika · VRM 1 rich diagnostic');
  await expect(page.getByText('丰富面捕候选', { exact: false })).toBeVisible();
  await expect(page.locator('.capability-list > div')).toHaveCount(13);
  await captureEvidence(page, 'vrm1-half.png');
  await page.getByRole('button', { name: '头部', exact: true }).click();
  await settleFrame(page);
  await captureEvidence(page, 'vrm1-head.png');
  await page.getByRole('button', { name: '映射与调节', exact: true }).click();
  const leftBlinkRule = page.locator('.mapping-rule').filter({ has: page.locator('select[aria-label^="目标表情"] option:checked', { hasText: /^blinkLeft$/ }) });
  await leftBlinkRule.getByRole('button', { name: '试动', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止试动', exact: true })).toBeVisible();
  await settleFrame(page);
  await captureEvidence(page, 'vrm1-blink-left.png');
  await page.getByRole('button', { name: '停止试动', exact: true }).click();
  await page.getByRole('button', { name: '驱动与校准', exact: true }).click();

  await page.getByLabel('导入 VRM 模型', { exact: true }).setInputFiles({ name: 'broken.vrm', mimeType: 'application/octet-stream', buffer: Buffer.from('not a VRM') });
  await expect(page.getByRole('alert')).toContainText('文件不完整');
  await expect(page.locator('.asset-info strong')).toHaveText('Mika · VRM 1 rich diagnostic');
  await expect(page.locator('.viewport canvas')).toBeVisible();

  await importModel(page, 'diagnostic-vrm0.vrm', 'Mika · VRM 0 diagnostic');
  await expect(page.locator('.capability-list')).toContainText('aa');
  await expect(page.locator('.capability-list')).toContainText('happy');
  await page.getByRole('button', { name: '半身', exact: true }).click();
  await settleFrame(page);
  await captureEvidence(page, 'vrm0-half.png');

  await importModel(page, 'diagnostic-vrm1-minimal.vrm', 'Mika · VRM 1 missing channels');
  await expect(page.getByText('缺少已识别的张嘴表情')).toBeVisible();
  await expect(page.getByText('缺少完整眨眼表情；请检查左右眼映射')).toBeVisible();
  await expect(page.locator('.capability-list > div')).toHaveCount(0);
  await captureEvidence(page, 'vrm1-minimal.png');
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('saves and restores settings by file hash, exports JSON, and rejects another model configuration', async ({ page }) => {
  await page.goto('/');
  await importModel(page, 'diagnostic-vrm1-rich.vrm', 'Mika · VRM 1 rich diagnostic');
  await page.getByLabel('风格预设').selectOption('enhanced');
  await page.getByRole('button', { name: '头部', exact: true }).click();
  await page.getByLabel('背景颜色').fill('#aaccee');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('.message[role="status"]')).toContainText('配置已保存');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const downloaded = await pendingDownload;
  expect(downloaded.suggestedFilename()).toBe('ar-capture-config.json');
  const configPath = resolve(screenshots, 'exported-config.json');
  await downloaded.saveAs(configPath);

  await page.reload();
  await expect(page.getByLabel('背景颜色')).toHaveValue('#aaccee');
  await expect(page.getByRole('button', { name: '头部', exact: true })).toHaveClass(/selected/);
  await importModel(page, 'diagnostic-vrm1-rich.vrm', 'Mika · VRM 1 rich diagnostic');
  await expect(page.locator('.message[role="status"]')).toContainText('按模型文件哈希恢复配置');
  await expect(page.getByLabel('风格预设')).toHaveValue('enhanced');
  await page.getByLabel('导入配置 JSON').setInputFiles(configPath);
  await expect(page.locator('.message[role="status"]')).toContainText('配置校验通过');

  await importModel(page, 'diagnostic-vrm1-minimal.vrm', 'Mika · VRM 1 missing channels');
  await page.getByLabel('导入配置 JSON').setInputFiles(configPath);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.asset-info strong')).toHaveText('Mika · VRM 1 missing channels');
  await page.getByRole('button', { name: '清除全部本地配置' }).click();
  await expect(page.locator('.message[role="status"]')).toContainText('已全部清除');
  await page.reload();
  await expect(page.getByLabel('背景颜色')).toHaveValue('#dce9e5');
});

test('clean display hides panels and Escape returns to studio', async ({ page }) => {
  await page.goto('/');
  await importModel(page, 'diagnostic-vrm1-rich.vrm', 'Mika · VRM 1 rich diagnostic');
  await page.getByRole('button', { name: '简洁展示 ↗' }).click();
  await expect(page.locator('.left-column')).toBeHidden();
  await expect(page.locator('.right-column')).toBeHidden();
  await expect(page.locator('.viewport canvas')).toBeVisible();
  await settleFrame(page);
  await captureEvidence(page, 'clean-display.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('.left-column')).toBeVisible();
  await expect(page.locator('.right-column')).toBeVisible();
});
