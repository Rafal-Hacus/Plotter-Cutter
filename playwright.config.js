import { defineConfig, devices } from '@playwright/test';

// Runs against the production build (vite preview), the same files that get deployed.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173/', acceptDownloads: true, viewport: { width: 1400, height: 900 }, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    { command: 'npx vite build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    // the real server with a login, on the same build, with a fresh data folder each run
    {
      command: 'node -e "require(\'fs\').rmSync(\'.tmp/e2e-data\',{recursive:true,force:true})" && node server/index.js',
      url: 'http://localhost:4174/healthz', reuseExistingServer: false, timeout: 60_000,
      env: { PORT: '4174', HOST: '127.0.0.1', DATA_DIR: '.tmp/e2e-data', STATIC_DIR: 'dist', AUTH_USERNAME: 'shop', AUTH_PASSWORD: 'e2e password 123' }
    }
  ]
});
