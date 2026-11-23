import { defineConfig, devices } from '@playwright/test';

// Runs against the production build (vite preview), the same files that get deployed.
// E2E_PORT / E2E_SERVER_PORT move both servers (default 4173 / 4174), so several checkouts can test side by side.
const PORT = +process.env.E2E_PORT || 4173, SERVER_PORT = +process.env.E2E_SERVER_PORT || 4174;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}/`, acceptDownloads: true, viewport: { width: 1400, height: 900 }, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    { command: `npx vite build && npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
    // the real server with a login, on the same build, with a fresh data folder each run
    {
      // it serves dist: wait until the build above is done (the preview answers), or it serves half-written files
      command: `node -e "require('fs').rmSync('.tmp/e2e-data',{recursive:true,force:true})" && until curl -sf http://localhost:${PORT}/ >/dev/null; do sleep 0.5; done && node server/index.js`,
      url: `http://localhost:${SERVER_PORT}/healthz`, reuseExistingServer: false, timeout: 180_000, // (includes waiting for the build)
      env: { PORT: String(SERVER_PORT), HOST: '127.0.0.1', DATA_DIR: '.tmp/e2e-data', STATIC_DIR: 'dist', AUTH_USERNAME: 'shop', AUTH_PASSWORD: 'e2e password 123' }
    }
  ]
});
