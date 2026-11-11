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
  webServer: { command: 'npx vite build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: !process.env.CI, timeout: 120_000 }
});
