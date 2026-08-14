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

(async () => {
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
        "--disable-blink-features=AutomationControlled"
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

    try {
        await page.goto(targetUrl, {
            waitUntil: "networkidle",
            timeout: 120000
        });

        if (!fs.existsSync("screenshots")) {
            fs.mkdirSync("screenshots", { recursive: true });
        }

        const safeIp = (ipInfo.ip || 'ip').replace(/[^a-zA-Z0-9.-]/g, '_');
        const filename = `screenshots/${process.platform}_${ipInfo.country}_${safeIp}.png`;

        await page.screenshot({
            path: filename,
            fullPage: true
        });

        // Also create a fallback/standard screenshot name
        await page.screenshot({
            path: `screenshots/${process.platform}.png`,
            fullPage: true
        });

        console.log(`📸 Screenshot successfully captured at: ${filename}`);
    } catch (err) {
        console.error(`❌ Page navigation / screenshot error:`, err.message);
    } finally {
        await browser.close();
    }
})();