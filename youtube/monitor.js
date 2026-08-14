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
 * Helper to handle overlays, consent dialogs, sign-in prompts, and skip ads
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

        // Click "Skip Ad" or close ad overlay if available
        const adSkipSelectors = [
            '.ytp-skip-ad-button',
            '.ytp-ad-skip-button-modern',
            '.ytp-ad-skip-button',
            '.ytp-ad-overlay-close-button',
            'button.ytp-ad-skip-button-icon'
        ];
        for (const selector of adSkipSelectors) {
            const skipBtn = await page.$(selector);
            if (skipBtn && await skipBtn.isVisible()) {
                console.log(`⏩ Clicking Skip Ad button...`);
                await skipBtn.click().catch(() => {});
            }
        }

        // Dismiss "Video paused. Continue watching?" or "Still watching?" dialog
        const confirmBtn = await page.$('yt-confirm-dialog-renderer #confirm-button, paper-dialog #confirm-button, yt-button-shape:has-text("Yes")');
        if (confirmBtn && await confirmBtn.isVisible()) {
            console.log(`🔘 Dismissing "Still watching?" prompt...`);
            await confirmBtn.click().catch(() => {});
        }

        // Dismiss YouTube "Sign in to get the best experience" or promo popups
        const dismissPromoBtn = await page.$('ytd-popup-container #dismiss-button, #dismiss-button ytd-button-renderer, tp-yt-paper-button:has-text("Dismiss"), yt-button-renderer:has-text("No thanks")');
        if (dismissPromoBtn && await dismissPromoBtn.isVisible()) {
            console.log(`🔘 Dismissing promo popup...`);
            await dismissPromoBtn.click().catch(() => {});
        }
    } catch {}
}

/**
 * Configure YouTube playlist loop and autoplay settings
 */
async function configurePlaylistAndAutoplay(page) {
    try {
        await page.evaluate(() => {
            const player = document.getElementById('movie_player');
            if (player) {
                // Ensure loop playlist is enabled via YouTube API
                if (typeof player.setLoop === 'function') {
                    player.setLoop(true);
                }
            }

            // Enable loop playlist button in UI if available and not yet active
            const loopBtn = document.querySelector('ytd-playlist-panel-renderer button[aria-label*="Loop"], .ytp-playlist-loop-button, button.ytp-playlist-loop-button');
            if (loopBtn) {
                const isAriaPressed = loopBtn.getAttribute('aria-pressed');
                if (isAriaPressed === 'false' || isAriaPressed === null) {
                    loopBtn.click();
                }
            }

            // Enable Autonav (Autoplay next video) if toggled off
            const autonavBtn = document.querySelector('.ytp-autonav-toggle-button');
            if (autonavBtn && autonavBtn.getAttribute('aria-checked') === 'false') {
                autonavBtn.click();
            }
        }).catch(() => {});
    } catch {}
}

/**
 * Get detailed player and video state
 */
async function getVideoState(page) {
    return await page.evaluate(() => {
        const v = document.querySelector('video');
        const player = document.getElementById('movie_player');
        const titleElem = document.querySelector('h1.ytd-watch-metadata, #title, ytd-watch-metadata h1');
        const title = titleElem?.innerText?.trim() || '';

        const playerState = player && typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
        // YouTube player states: -1: UNSTARTED, 0: ENDED, 1: PLAYING, 2: PAUSED, 3: BUFFERING, 5: CUED

        const currentTime = v && !isNaN(v.currentTime) ? Math.floor(v.currentTime) : 0;
        const duration = v && !isNaN(v.duration) && v.duration > 0 ? Math.floor(v.duration) : null;
        const isPaused = v ? v.paused : true;
        const isEnded = v ? v.ended : false;

        return {
            title: title.substring(0, 60),
            currentTime,
            duration,
            paused: isPaused,
            ended: isEnded,
            playerState,
            hasVideo: !!v
        };
    }).catch(() => ({
        title: '',
        currentTime: 0,
        duration: null,
        paused: true,
        ended: false,
        playerState: null,
        hasVideo: false
    }));
}

/**
 * Ensure video is actively playing, recover from ended/paused/stalled states
 */
async function ensureVideoPlaying(page, targetUrl, consecutiveStallCount = 0) {
    await handlePopupsAndAds(page);
    await configurePlaylistAndAutoplay(page);

    try {
        const state = await getVideoState(page);

        // Check if video is ended, stalled on NaN duration, or in ended player state
        const isVideoEndedOrStalled = state.ended || state.playerState === 0 || (!state.duration && state.currentTime === 0);
        const isPaused = state.paused || state.playerState === 2 || state.playerState === -1;

        if (isVideoEndedOrStalled && consecutiveStallCount >= 2) {
            console.log(`🔄 Playlist/Video ended or stalled at 0s/NaN. Restarting playlist navigation...`);
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
            await page.waitForTimeout(5000);
            await configurePlaylistAndAutoplay(page);
        }

        // If player is ended or replay button is visible, click replay / playVideo / nextVideo
        if (state.playerState === 0 || state.ended) {
            console.log(`🔁 Video ended. Triggering replay / next video in playlist...`);
            await page.evaluate(() => {
                const player = document.getElementById('movie_player');
                if (player) {
                    if (typeof player.nextVideo === 'function') player.nextVideo();
                    if (typeof player.playVideo === 'function') player.playVideo();
                }
                const replayBtn = document.querySelector('.ytp-play-button[title*="Replay"], .ytp-replay-button, button[aria-label*="Replay"]');
                if (replayBtn) replayBtn.click();
            }).catch(() => {});
            await page.waitForTimeout(2000);
        }

        if (isPaused || isVideoEndedOrStalled) {
            console.log(`▶️ Video is paused/idle (playerState: ${state.playerState}). Resuming playback...`);

            // 1. YouTube Player API call
            await page.evaluate(() => {
                const player = document.getElementById('movie_player');
                if (player && typeof player.playVideo === 'function') {
                    player.playVideo();
                }
            }).catch(() => {});

            // 2. Click player play button if it indicates paused
            const playButton = await page.$('.ytp-play-button[aria-label*="Play"], .ytp-play-button[title*="Play"]');
            if (playButton && await playButton.isVisible()) {
                await playButton.click().catch(() => {});
            }

            // 3. Focus player and press Space / 'k' key
            await page.focus('#movie_player').catch(() => {});
            await page.keyboard.press('k').catch(() => {});
            await page.waitForTimeout(1000);

            // 4. Fallback HTML5 play directly
            await page.evaluate(() => {
                const v = document.querySelector('video');
                if (v && v.paused) {
                    v.play().catch(() => {});
                }
            }).catch(() => {});
        }
    } catch (err) {
        console.warn(`⚠️ Warning in ensureVideoPlaying:`, err.message);
    }
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
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=CalculateNativeWinOcclusion,PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"
        ]
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

        // Ensure playback starts and playlist loop is configured
        await configurePlaylistAndAutoplay(page);
        await ensureVideoPlaying(page, targetUrl, 0);

        // Take initial screenshot (0m)
        await captureScreenshot("000m_start");

        const startTime = Date.now();
        let lastScreenshotTime = startTime;
        let elapsedMins = 0;
        let consecutiveStallCount = 0;
        let lastKnownTime = -1;

        console.log(`\n⏳ Continuous 2-hour monitoring loop started at ${new Date().toISOString()}...`);

        while (Date.now() - startTime < totalDurationMs) {
            // Heartbeat every 30 seconds to maintain playback & dismiss popups/ads
            await page.waitForTimeout(30000);

            const state = await getVideoState(page);

            // Track whether playback is progressing
            if (state.currentTime === lastKnownTime && state.currentTime > 0) {
                consecutiveStallCount++;
            } else if (!state.duration || state.currentTime === 0) {
                consecutiveStallCount++;
            } else {
                consecutiveStallCount = 0;
            }
            lastKnownTime = state.currentTime;

            await ensureVideoPlaying(page, targetUrl, consecutiveStallCount);

            const now = Date.now();
            const totalElapsed = now - startTime;
            const timeSinceLastScreenshot = now - lastScreenshotTime;

            elapsedMins = Math.floor(totalElapsed / (60 * 1000));

            // Log playback status every 5 minutes
            if (elapsedMins > 0 && elapsedMins % 5 === 0 && (totalElapsed % 60000 < 30000)) {
                const latestState = await getVideoState(page);
                const isActuallyPlaying = !latestState.paused && latestState.duration > 0 && !latestState.ended;
                const statusSymbol = isActuallyPlaying ? '▶️ Playing' : (latestState.ended ? '🔄 Ended / Replaying' : '⏸️ Paused / Buffering');
                const durStr = latestState.duration ? `${latestState.duration}s` : 'Unknown';
                const titleStr = latestState.title || '(Loading / Playlist Transition)';

                console.log(`[${elapsedMins}m / ${DURATION_MINUTES}m] Status: ${statusSymbol} | Time: ${latestState.currentTime}s / ${durStr} | "${titleStr}"`);
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