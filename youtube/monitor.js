import { chromium } from "playwright";
import fs from "fs";
import https from "https";

/**
 * Helper to fetch current public IP & Geo info
 */
async function getPublicIpInfo() {
    return new Promise((resolve) => {
        const req = https.get('https://ipinfo.io/json', { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ ip: parsed.ip || 'unknown', country: parsed.country || 'unknown', org: parsed.org || 'unknown' });
                } catch {
                    resolve({ ip: 'unknown', country: 'unknown', org: 'unknown' });
                }
            });
        });
        req.on('error', () => resolve({ ip: 'unknown', country: 'unknown', org: 'unknown' }));
        req.on('timeout', () => { req.destroy(); resolve({ ip: 'unknown', country: 'unknown', org: 'unknown' }); });
    });
}

/**
 * Helper to handle overlays, consent dialogs, and skip ads
 */
async function handlePopupsAndAds(page) {
    try {
        // Accept cookie / consent dialogs if present
        const consentSelectors = [
            'button[aria-label*="Accept"]',
            'button[aria-label*="Agree"]',
            'form[action*="consent"] button',
            'ytd-button-renderer:has-text("Accept all")',
            'ytd-button-renderer:has-text("Reject all")',
            'ytd-button-renderer:has-text("I agree")'
        ];
        for (const selector of consentSelectors) {
            const btn = await page.$(selector);
            if (btn && await btn.isVisible()) {
                console.log(`🔘 Dismissing consent button: ${selector}`);
                await btn.click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        // Click "Skip Ad" if available
        const adSkipSelectors = [
            '.ytp-skip-ad-button',
            '.ytp-ad-skip-button-modern',
            '.ytp-ad-skip-button',
            '.ytp-ad-overlay-close-button'
        ];
        for (const selector of adSkipSelectors) {
            const skipBtn = await page.$(selector);
            if (skipBtn && await skipBtn.isVisible()) {
                console.log(`⏩ Clicking Skip Ad button...`);
                await skipBtn.click().catch(() => {});
            }
        }

        // Dismiss "Video paused. Continue watching?" or "Still watching?" dialog
        const confirmBtn = await page.$('yt-confirm-dialog-renderer #confirm-button, paper-dialog #confirm-button');
        if (confirmBtn && await confirmBtn.isVisible()) {
            console.log(`🔘 Dismissing "Still watching?" prompt...`);
            await confirmBtn.click().catch(() => {});
        }
    } catch {}
}

/**
 * Ensure video is actively playing
 */
async function ensureVideoPlaying(page) {
    await handlePopupsAndAds(page);

    try {
        const isPaused = await page.evaluate(() => {
            const v = document.querySelector('video');
            return v ? v.paused : true;
        });

        // Windows automatically autoplays video on load; skip spacebar toggle to avoid pausing
        if (process.platform === 'win32') {
            if (isPaused) {
                console.log(`🪟 Windows platform: Video is paused, invoking HTML5 play directly (skipping Space toggle)...`);
                await page.evaluate(() => {
                    const v = document.querySelector('video');
                    if (v && v.paused) v.play().catch(() => {});
                });
            }
            return;
        }

        // On Linux / macOS, press Space if paused
        if (isPaused) {
            console.log(`▶️ Video is paused. Pressing Space to start/resume playback...`);
            // Focus player and press Space
            await page.focus('#movie_player').catch(() => {});
            await page.keyboard.press('Space');
            await page.waitForTimeout(1500);

            // Double check and force HTML5 play if needed
            await page.evaluate(() => {
                const v = document.querySelector('video');
                if (v && v.paused) {
                    v.play().catch(() => {});
                }
            });
        }
    } catch {}
}

(async () => {
    // Duration and interval settings (defaults: 2 hours total, screenshot every 30 mins)
    const DURATION_MINUTES = parseInt(process.env.DURATION_MINUTES || '120', 10);
    const SCREENSHOT_INTERVAL_MINUTES = parseInt(process.env.SCREENSHOT_INTERVAL_MINUTES || '30', 10);

    const totalDurationMs = DURATION_MINUTES * 60 * 1000;
    const screenshotIntervalMs = SCREENSHOT_INTERVAL_MINUTES * 60 * 1000;

    console.log(`⏱️ Configured Run Duration: ${DURATION_MINUTES} minutes (Screenshots every ${SCREENSHOT_INTERVAL_MINUTES} minutes)`);

    // Check for proxy from env or args
    const proxyArgIndex = process.argv.indexOf('--proxy');
    const proxyServer = proxyArgIndex !== -1 ? process.argv[proxyArgIndex + 1] : process.env.PROXY_SERVER;

    console.log(`🌐 Outbound IP Verification...`);
    const ipInfo = await getPublicIpInfo();
    console.log(`📍 Current Public IP: ${ipInfo.ip} | Country: ${ipInfo.country} | Org: ${ipInfo.org}`);

    const launchOptions = {
        headless: true
    };

    // Auto-detect installed system Chrome if Playwright's local cache is missing
    const possibleChromePaths = [
        process.env.CHROME_BIN,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ].filter(Boolean);

    const detectedChrome = possibleChromePaths.find(p => fs.existsSync(p));
    if (detectedChrome) {
        launchOptions.executablePath = detectedChrome;
    }

    if (proxyServer) {
        console.log(`🔌 Using Proxy: ${proxyServer}`);
        launchOptions.proxy = { server: proxyServer };
    } else {
        console.log(`🚀 Using Direct / Active System VPN connection.`);
    }

    const authPath = "youtube/auth_state.json";
    let storageState = undefined;

    // Check if auth state exists on disk or via environment variable
    if (fs.existsSync(authPath)) {
        console.log(`🔑 Loaded authenticated session from: ${authPath}`);
        storageState = authPath;
    } else if (process.env.AUTH_STATE_JSON) {
        try {
            const parsed = JSON.parse(process.env.AUTH_STATE_JSON);
            fs.writeFileSync(authPath, JSON.stringify(parsed, null, 2), "utf8");
            console.log(`🔑 Created and loaded authenticated session from AUTH_STATE_JSON secret.`);
            storageState = authPath;
        } catch (e) {
            console.warn(`⚠️ Failed to parse AUTH_STATE_JSON environment variable.`);
        }
    }

    launchOptions.args = [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--autoplay-policy=no-user-gesture-required"
    ];

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ...(storageState ? { storageState } : {})
    });

    const page = await context.newPage();

    const targetUrl = process.env.TARGET_URL || "https://www.youtube.com/watch?v=wvqdwiYKXSY&list=PLaW-yAT1_JFV5GyJX6fsuhbXTNLKVTeqS&index=1";
    console.log(`🎥 Navigating to: ${targetUrl}`);

    if (!fs.existsSync("screenshots")) {
        fs.mkdirSync("screenshots", { recursive: true });
    }

    const safeIp = (ipInfo.ip || 'ip').replace(/[^a-zA-Z0-9.-]/g, '_');

    const captureScreenshot = async (marker) => {
        try {
            const filename = `screenshots/${process.platform}_${ipInfo.country}_${safeIp}_${marker}.png`;
            await page.screenshot({ path: filename, fullPage: true });
            await page.screenshot({ path: `screenshots/${process.platform}.png`, fullPage: true });
            console.log(`📸 [${marker}] Screenshot saved: ${filename}`);
        } catch (err) {
            console.error(`⚠️ Failed to capture screenshot for ${marker}:`, err.message);
        }
    };

    try {
        await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 120000
        });

        // Wait a few seconds for player elements to load
        await page.waitForTimeout(5000);

        // Click spacebar and start playback
        await ensureVideoPlaying(page);

        // Take initial screenshot (0m)
        await captureScreenshot("000m_start");

        const startTime = Date.now();
        let lastScreenshotTime = startTime;
        let elapsedMins = 0;

        console.log(`\n⏳ Continuous 2-hour monitoring loop started at ${new Date().toISOString()}...`);

        while (Date.now() - startTime < totalDurationMs) {
            // Heartbeat every 30 seconds to maintain playback & dismiss popups/ads
            await page.waitForTimeout(30000);
            await ensureVideoPlaying(page);

            const now = Date.now();
            const totalElapsed = now - startTime;
            const timeSinceLastScreenshot = now - lastScreenshotTime;

            elapsedMins = Math.floor(totalElapsed / (60 * 1000));

            // Log playback status every 5 minutes
            if (elapsedMins > 0 && elapsedMins % 5 === 0 && (totalElapsed % 60000 < 30000)) {
                const videoStatus = await page.evaluate(() => {
                    const v = document.querySelector('video');
                    const title = document.querySelector('h1.ytd-watch-metadata, #title')?.innerText || 'Unknown';
                    return {
                        title: title.trim().substring(0, 60),
                        currentTime: v ? Math.floor(v.currentTime) : 0,
                        duration: v ? Math.floor(v.duration) : 0,
                        paused: v ? v.paused : true
                    };
                }).catch(() => ({ title: 'Unknown', currentTime: 0, duration: 0, paused: true }));

                console.log(`[${elapsedMins}m / ${DURATION_MINUTES}m] Status: ${videoStatus.paused ? '⏸️ Paused' : '▶️ Playing'} | Time: ${videoStatus.currentTime}s / ${videoStatus.duration}s | "${videoStatus.title}"`);
            }

            // Capture screenshot every SCREENSHOT_INTERVAL_MINUTES
            if (timeSinceLastScreenshot >= screenshotIntervalMs) {
                lastScreenshotTime = now;
                const marker = `${String(elapsedMins).padStart(3, '0')}m`;
                await captureScreenshot(marker);
            }
        }

        // Final screenshot at completion
        await captureScreenshot(`${String(DURATION_MINUTES).padStart(3, '0')}m_final`);
        console.log(`\n🎉 Completed ${DURATION_MINUTES} minutes (2 hours) of video playback & monitoring!`);

    } catch (err) {
        console.error(`❌ Page navigation / playback error:`, err.message);
        await captureScreenshot("error");
    } finally {
        await browser.close();
    }
})();