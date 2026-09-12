import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 180000,
  use: {
    baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npm.cmd run dev -- --port 4173', url: 'http://localhost:4173', reuseExistingServer: true },
});
