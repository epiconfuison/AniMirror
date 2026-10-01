import { spawn } from 'node:child_process';
import { createServer, preview } from 'vite';
const production = process.argv.includes('--production');
const port = production ? 4173 : 5173;
// Own the HTTP server in this process. This also avoids orphaned Windows shell
// children during Playwright webServer teardown.
const server = production ? await preview({ preview: { host: '127.0.0.1', port, strictPort: true } })
  : await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
if (!production) await server.listen();
let status = 1;
try {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
    stdio: 'inherit', env: { ...process.env, TEST_BUILD: production ? '1' : '0', PLAYWRIGHT_EXTERNAL_SERVER: '1' },
  });
  status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} finally {
  if (production) await new Promise(resolve => { server.httpServer.closeAllConnections(); server.httpServer.close(resolve); });
  else await server.close();
}
process.exitCode = status;
