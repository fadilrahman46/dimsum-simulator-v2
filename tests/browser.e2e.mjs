import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4185;
const BASE_URL = process.env.QA_TARGET_URL || `http://127.0.0.1:${PORT}`;

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function waitForServer(url, serverProc, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(`Vite server exited prematurely with code ${serverProc.exitCode}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) {
        const html = await res.text();
        if (html.includes('Dimsum')) return;
      }
    } catch {
      // keep polling until server is ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Vite server at ${url}`);
}

async function auditViewportLayout(page, label, width, height) {
  await page.setViewportSize({ width, height });
  await page
    .waitForFunction(
      ({ w, h }) => {
        const c = document.querySelector('[data-testid="dimsum-world-canvas"] canvas');
        if (!c) return false;
        const r = c.getBoundingClientRect();
        return r.width >= w - 2 && r.height >= h - 2;
      },
      { w: width, h: height },
      { timeout: 3_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);

  const metrics = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docOverflowX = document.documentElement.scrollWidth - vw;
    const canvas = document.querySelector('[data-testid="dimsum-world-canvas"] canvas');
    const canvasRect = canvas ? canvas.getBoundingClientRect() : null;

    const pauseBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /Menu|Jeda/i.test(b.getAttribute('aria-label') || b.textContent || ''),
    );
    const hidePanelBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /Hide Left Panel|Show Left Panel|Panel Kiri/i.test(b.getAttribute('aria-label') || b.textContent || ''),
    );
    const quickDockBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /Hide Quick Dock|Show Quick Dock|Pintasan/i.test(b.textContent || ''),
    );
    const zoomBtn = document.querySelector('button[aria-label="Zoom In"], button[aria-label="Perbesar Kamera"]');

    const checkBox = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        inViewport:
          r.width > 0 &&
          r.height > 0 &&
          r.left >= -2 &&
          r.top >= -2 &&
          r.right <= vw + 2 &&
          r.bottom <= vh + 2,
      };
    };

    return {
      vw,
      vh,
      docOverflowX,
      canvasRect: canvasRect
        ? { width: canvasRect.width, height: canvasRect.height }
        : null,
      pauseBtn: checkBox(pauseBtn),
      hidePanelBtn: checkBox(hidePanelBtn),
      quickDockBtn: checkBox(quickDockBtn),
      zoomBtn: checkBox(zoomBtn),
    };
  });

  assert.ok(metrics.docOverflowX <= 2, `[${label}] Horizontal overflow detected: ${metrics.docOverflowX}px`);
  assert.ok(
    metrics.canvasRect && metrics.canvasRect.width >= width - 2 && metrics.canvasRect.height >= height - 2,
    `[${label}] WebGL canvas should fill viewport, got ${JSON.stringify(metrics.canvasRect)}`,
  );
  assert.ok(metrics.pauseBtn?.inViewport, `[${label}] Pause/Menu button clipped: ${JSON.stringify(metrics.pauseBtn)}`);
  assert.ok(metrics.hidePanelBtn?.inViewport, `[${label}] Hide Left Panel button clipped: ${JSON.stringify(metrics.hidePanelBtn)}`);
  assert.ok(metrics.quickDockBtn?.inViewport, `[${label}] Quick Dock toggle clipped: ${JSON.stringify(metrics.quickDockBtn)}`);
  assert.ok(metrics.zoomBtn?.inViewport, `[${label}] 3D Camera Zoom control clipped: ${JSON.stringify(metrics.zoomBtn)}`);

  // Verify Left Panel Toggle cleanly hides & restores left panel (including Daily Missions & Daily Goals)
  await page.getByRole('button', { name: /Hide Left Panel/i }).click();
  await page.waitForTimeout(150);
  const afterHideText = await page.locator('body').innerText();
  assert.ok(!afterHideText.includes('Daily Goals'), `[${label}] Left panel should hide when toggled`);
  assert.ok(!afterHideText.includes('Daily Missions'), `[${label}] Daily Missions should hide with left panel`);
  await page.getByRole('button', { name: /Show Left Panel/i }).click();
  await page.waitForTimeout(150);
  const afterShowText = await page.locator('body').innerText();
  assert.ok(afterShowText.includes('Daily Goals'), `[${label}] Left panel should reappear when toggled`);
  assert.ok(afterShowText.includes('Daily Missions'), `[${label}] Daily Missions should reappear when toggled`);

  // Open a modal at this viewport and assert it stays inside viewport bounds
  await page.getByRole('button', { name: /^Market$/i }).click();
  await page.waitForTimeout(200);
  const modalBox = await page.evaluate(() => {
    const dialog = document.querySelector('h2')?.closest('div[class*="rounded-2xl"]');
    if (!dialog) return null;
    const r = dialog.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  });
  assert.ok(modalBox, `[${label}] Market modal dialog not found`);
  assert.ok(
    modalBox.left >= -2 && modalBox.right <= width + 2 && modalBox.bottom <= height + 2,
    `[${label}] Modal overflowed viewport ${width}x${height}: ${JSON.stringify(modalBox)}`,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

async function runBrowserQa() {
  let serverProc = null;
  let serverLogs = '';
  if (!process.env.QA_TARGET_URL) {
    serverProc = spawn(
      process.execPath,
      [
        path.resolve('node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--strictPort',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DISABLE_HMR: 'true' },
      },
    );
    serverProc.stdout?.on('data', (chunk) => {
      serverLogs += chunk.toString();
    });
    serverProc.stderr?.on('data', (chunk) => {
      serverLogs += chunk.toString();
    });
    await waitForServer(BASE_URL, serverProc);
  }

  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!/WebSocket/i.test(text)) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForSelector('[data-testid="dimsum-world-canvas"] canvas', { timeout: 30_000 });
    await page.waitForTimeout(500);

    // 1. Verify WebGL canvas mounted & non-blank rendered screenshot
    const initialStats = await page.evaluate(() => window.__DIMSUM_QA__?.getSceneStats());
    assert.ok(initialStats?.webglActive, 'Three.js WebGL context must be active');
    assert.equal(initialStats.stationCount, 9, 'All 9 3D restaurant stations must mount');

    const canvasShot = await page.locator('[data-testid="dimsum-world-canvas"] canvas').screenshot();
    assert.ok(canvasShot.byteLength > 8_000, '3D canvas screenshot must contain rendered geometry');

    // 2. Navigate TitleScreen -> BusinessSetupModal -> Gameplay
    await page.getByRole('button', { name: /Start New Business/i }).click();
    await page.waitForSelector('input[type="text"]');
    await page.getByRole('button', { name: /Open Kitchen & Begin Day 1/i }).click();
    await page.waitForTimeout(300);

    const skipBtn = page.getByRole('button', { name: /^Skip$/i });
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }
    await page.waitForTimeout(600); // wait for camera settle on player

    // 3. Test 3D Station Click Raycasting on real canvas coordinates
    const stationChecks = [
      { id: 'market', heading: /Ingredient & Packaging Market/i },
      { id: 'prep', heading: /Preparation, Recipe Book & R&D/i },
      { id: 'cashier', heading: /Cashier & Customer Service/i },
      { id: 'board', heading: /Business Report & Facility Upgrades/i },
    ];

    for (const st of stationChecks) {
      const projected = await page.evaluate(
        (stationId) => window.__DIMSUM_QA__?.projectStation(stationId),
        st.id,
      );
      assert.ok(projected && projected.inBounds, `Station ${st.id} must project inside canvas viewport`);

      await page.mouse.move(projected.x, projected.y);
      await page.waitForTimeout(140);
      await page.mouse.click(projected.x, projected.y);
      await page.waitForSelector(`h2`, { timeout: 5_000 });
      const modalText = await page.locator('h2').first().innerText();
      assert.match(modalText, st.heading, `3D click on ${st.id} should open matching modal (got "${modalText}")`);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(180);
    }

    // 4. Test 3D Decoration Upgrade progression via Finance Board -> Equipment Upgrades
    await page.getByRole('button', { name: /^Finance$/i }).click();
    await page.getByRole('button', { name: /Equipment Upgrades/i }).click();
    await page.waitForTimeout(150);

    const statsBeforeUpgrade = await page.evaluate(() => window.__DIMSUM_QA__?.getSceneStats());
    assert.equal(statsBeforeUpgrade.lanternCount, 1);
    assert.equal(statsBeforeUpgrade.plantCount, 1);

    // Purchase Shop Interior & Lanterns Lv 2 (cost Rp80.000, starter cash is Rp100.000)
    await page
      .locator('div.rounded-xl', { hasText: /Shop Interior & Lanterns/i })
      .getByRole('button', { name: /Upgrade/i })
      .click();
    await page.waitForTimeout(250);

    const statsAfterUpgrade = await page.evaluate(() => window.__DIMSUM_QA__?.getSceneStats());
    assert.equal(statsAfterUpgrade.lanternCount, 2, 'Upgrading decor to Lv 2 should add a second 3D lantern');
    assert.equal(statsAfterUpgrade.plantCount, 3, 'Upgrading decor to Lv 2 should add right-wing herbal planters');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // 5. Audit responsive HUD & modal layouts across Mobile, Tablet, 720p, and 1080p
    const viewports = [
      { label: 'mobile-390x844', width: 390, height: 844 },
      { label: 'tablet-768x1024', width: 768, height: 1024 },
      { label: 'desktop-1280x720', width: 1280, height: 720 },
      { label: 'desktop-1920x1080', width: 1920, height: 1080 },
    ];
    for (const vp of viewports) {
      await auditViewportLayout(page, vp.label, vp.width, vp.height);
    }

    assert.deepEqual(pageErrors, [], `Uncaught page errors detected: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors detected: ${consoleErrors.join(' | ')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          webglActive: initialStats.webglActive,
          raycastedStations: stationChecks.map((s) => s.id),
          decorUpgradeVerified: {
            before: { lanterns: statsBeforeUpgrade.lanternCount, plants: statsBeforeUpgrade.plantCount },
            after: { lanterns: statsAfterUpgrade.lanternCount, plants: statsAfterUpgrade.plantCount },
          },
          viewportsAudited: viewports.map((v) => v.label),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
  }
}

runBrowserQa().catch((err) => {
  console.error('Browser QA Suite Failed:', err);
  process.exit(1);
});
