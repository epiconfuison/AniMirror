import { defineConfig } from '@playwright/test';
const production = process.env.TEST_BUILD === '1';
const port = production ? 4173 : 5173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  outputDir: '.cache/playwright-results',
  reporter: [['list'], ['json', { outputFile: `.cache/${production ? 'production' : 'development'}-browser-results.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1600, height: 1100 },
    launchOptions: {
      executablePath: process.env.EDGE_EXECUTABLE ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
      args: ['--enable-webgl', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1' ? undefined : {
    command: `node node_modules/vite/bin/vite.js ${production ? 'preview' : ''} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
