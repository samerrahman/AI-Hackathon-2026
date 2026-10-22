import { defineConfig } from '@playwright/test';
// Each run gets its own API process (fresh in-memory rate limit) and its own Vite proxying to it,
// so repeated runs never hit "Too many study requests" from the shared dev server on :3001.
const api = 'http://127.0.0.1:3101';
const web = 'http://127.0.0.1:5174';
export default defineConfig({
  testDir: './tests', timeout: 60_000, workers: 1,
  use: { baseURL: web, browserName: 'chromium', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npx tsx server/dev.ts', url: `${api}/api/health`, env: { PORT: '3101' }, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort', url: web, env: { API_URL: api }, reuseExistingServer: false, timeout: 60_000 },
  ],
  reporter: 'list', outputDir: 'test-results',
});
