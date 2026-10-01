import { test, expect } from '@playwright/test';
test.use({ permissions: ['camera'], launchOptions: {
  executablePath: process.env.EDGE_EXECUTABLE ?? (process.platform === 'win32' && !process.env.CI ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    ...(process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader'] : [])],
} });
test.describe('local camera and Worker', () => {
  test('initializes local WASM, pauses without closing camera, then stops all tracks', async ({ page }) => {
    test.setTimeout(60000);
    const external: string[] = [];
    page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:')) external.push(req.url()); });
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as unknown as { capturedStreams: MediaStream[] }).capturedStreams = [];
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); (window as unknown as { capturedStreams: MediaStream[] }).capturedStreams.push(stream); return stream; };
    });
    await page.goto('/');
    await page.getByRole('button', { name: '开启摄像头' }).click();
    await expect(page.getByText('追踪运行中', { exact: true })).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '暂停追踪', exact: true }).click();
    await expect(page.getByText('已暂停 · 摄像头保持连接')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { capturedStreams: MediaStream[] }).capturedStreams[0].getTracks().every(t => t.readyState === 'live'))).toBe(true);
    await page.getByRole('button', { name: '继续追踪' }).click();
    await expect(page.getByText('追踪运行中', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭摄像头', exact: true }).click();
    await expect(page.getByText('摄像头已关闭', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { capturedStreams: MediaStream[] }).capturedStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
    expect(external).toEqual([]);
  });
});
test('denied permission offers a recoverable error', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/'); await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.getByRole('alert')).toContainText('摄像头权限被拒绝');
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeEnabled();
});
