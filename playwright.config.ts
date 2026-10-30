import { defineConfig } from "@playwright/test";

const externalPreview = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "app.spec.ts",
    "immersive.spec.ts",
    "location.spec.ts",
    "cinematic.spec.ts",
  ],
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: externalPreview || "http://localhost:4174",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: externalPreview
    ? undefined
    : {
        command: "npm run dev -- --port 4174 --strictPort",
        url: "http://localhost:4174",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
