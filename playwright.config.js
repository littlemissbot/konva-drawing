import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// Chromium is pre-installed in this project's dev containers at a
// non-default location; PLAYWRIGHT_BROWSERS_PATH (set in that
// environment) makes the default chromium.launch() find it without any
// executablePath override here. CI (see .github/workflows/ci.yml) has no
// such pre-install and runs `npx playwright install --with-deps chromium`
// instead - this config works unchanged in both cases.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The npm-installed @playwright/test version can pin a browser
        // build newer than what's pre-cached in this project's dev
        // containers (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers,
        // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 stops npm postinstall from
        // re-fetching), so `playwright install` is never run there;
        // this stable path always resolves to whatever build is
        // actually cached. CI has no such pre-install and installs a
        // matching browser instead (see .github/workflows/ci.yml), so
        // this only takes effect when the path exists.
        launchOptions: fs.existsSync("/opt/pw-browsers/chromium")
          ? { executablePath: "/opt/pw-browsers/chromium" }
          : {},
      },
    },
  ],
  // `npm run build` runs as its own CI step first (see workflow) so the
  // preview server serves the same production bundle CI just built. In
  // local dev, reuseExistingServer lets `npm run test:e2e` reuse an
  // already-running preview server if you started one yourself; if not,
  // it builds+starts one for you.
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/canvas.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
