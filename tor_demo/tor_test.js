import puppeteer from 'puppeteer-core';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// Find local browser executable
function findBrowserExecutable() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  try {
    const whichChrome = execSync('which google-chrome || which chromium', { encoding: 'utf8' }).trim();
    if (whichChrome && existsSync(whichChrome)) return whichChrome;
  } catch (e) {
    // Ignore error
  }

  throw new Error('Chrome/Chromium executable not found. Please install Google Chrome or Chromium.');
}

/**
 * Gets a fresh fallback proxy from search_config.json or config.json if Tor is blocked
 */
function getFallbackProxy() {
  try {
    const configPath = path.resolve('../search_config.json');
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, 'utf8'));
      if (data.proxies && data.proxies.length > 0) {
        const remote = data.proxies.find(p => !p.includes('127.0.0.1') && !p.includes('localhost'));
        if (remote) {
          return remote.startsWith('socks5://') || remote.startsWith('http://') ? remote : `socks5://${remote}`;
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

/**
 * Runs a single Puppeteer session through Tor or Proxy with GA Event Tracking & Engagement
 * @param {string} targetUrl - Webpage to visit
 * @param {string} socksProxy - Tor SOCKS5 proxy endpoint (default: socks5://127.0.0.1:9050)
 * @param {{username?: string, password?: string}} [auth] - Optional proxy auth
 * @param {{headless?: boolean, enableFallback?: boolean, recordVideo?: boolean}} [options] - Configuration options
 */
export async function runTorSession(
  targetUrl = 'https://justpasteit.in/', 
  socksProxy = 'socks5://127.0.0.1:9050', 
  auth = null,
  options = { headless: false, enableFallback: true, recordVideo: true }
) {
  const isHeadless = options.headless ?? false;
  console.log(`\n---------------------------------------------------`);
  console.log(`🖥️ Launching Browser Engine (Headless: ${isHeadless})...`);
  console.log(`🚀 Primary Proxy: ${socksProxy}`);
  
  const executablePath = findBrowserExecutable();
  console.log(`📍 Using browser binary: ${executablePath}`);

  let activeProxy = socksProxy;

  const launchBrowser = async (proxyUrl) => {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--window-size=1366,768'
    ];
    if (proxyUrl) {
      launchArgs.push(`--proxy-server=${proxyUrl}`);
    }

    return await puppeteer.launch({
      executablePath,
      headless: isHeadless,
      ignoreHTTPSErrors: true,
      defaultViewport: { width: 1366, height: 768 },
      args: launchArgs
    });
  };

  let browser;
  try {
    browser = await launchBrowser(activeProxy);
  } catch (e) {
    console.error(`❌ Failed to launch browser with proxy ${activeProxy}:`, e.message);
    return;
  }

  let recorder = null;
  let videoPath = null;

  const setupPage = async (b) => {
    const p = await b.newPage();
    await p.setViewport({ width: 1366, height: 768 });

    // Mask navigator.webdriver for realistic GA tracking
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Monitor for Google Analytics requests
    let gaEventsFired = 0;
    p.on('request', (req) => {
      const u = req.url();
      if (u.includes('google-analytics.com') || u.includes('analytics.google.com') || u.includes('/g/collect')) {
        gaEventsFired++;
        console.log(`📊 [GA Event Dispatched] -> ${u.substring(0, 80)}...`);
      }
    });

    return { page: p, getGaCount: () => gaEventsFired };
  };

  try {
    let { page, getGaCount } = await setupPage(browser);
    
    if (auth && auth.username && activeProxy === socksProxy) {
      await page.authenticate({ username: auth.username, password: auth.password }).catch(() => {});
    }

    // Setup Video Recording
    if (options.recordVideo !== false) {
      try {
        const videosDir = path.resolve('./videos');
        if (!existsSync(videosDir)) {
          mkdirSync(videosDir, { recursive: true });
        }
        videoPath = path.join(videosDir, `tor_session_${Date.now()}.mp4`);
        recorder = new PuppeteerScreenRecorder(page, { fps: 25, aspectRatio: '16:9' });
        await recorder.start(videoPath);
        console.log(`🎥 Video Recording Started: ${videoPath}`);
      } catch (recErr) {
        recorder = null;
      }
    }

    // Step 1: Check IP Address
    console.log(`🌐 Testing connection & checking IP via api.ipify.org...`);
    let connectionSuccess = false;
    try {
      await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 7000 });
      const ipText = await page.evaluate(() => document.body.innerText);
      if (ipText && !ipText.includes('ERR_')) {
        console.log(`✅ Verified Outgoing IP: ${ipText.trim()}`);
        connectionSuccess = true;
      }
    } catch (err) {
      console.warn(`⚠️ Primary proxy (${activeProxy}) is unavailable on local network.`);
    }

    // Step 2: Fallback handling if proxy connection failed on local corporate network
    if (!connectionSuccess && options.enableFallback) {
      const fallback = getFallbackProxy();
      if (fallback) {
        console.log(`🔄 Trying harvested public proxy: ${fallback}...`);
        if (recorder) { await recorder.stop().catch(() => {}); recorder = null; }
        await browser.close();
        activeProxy = fallback;
        browser = await launchBrowser(activeProxy);
        const res = await setupPage(browser);
        page = res.page;
        getGaCount = res.getGaCount;
        
        if (videoPath) {
          recorder = new PuppeteerScreenRecorder(page, { fps: 25, aspectRatio: '16:9' });
          await recorder.start(videoPath).catch(() => { recorder = null; });
        }

        try {
          await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 7000 });
          const fbIp = await page.evaluate(() => document.body.innerText);
          if (fbIp && !fbIp.includes('ERR_')) {
            console.log(`✅ Fallback Proxy Outgoing IP: ${fbIp.trim()}`);
            connectionSuccess = true;
          }
        } catch (e) {
          console.warn(`⚠️ Fallback proxy timed out on local network.`);
        }
      }

      // Final fallback: Direct Connection for local testing
      if (!connectionSuccess) {
        console.log(`🌐 Falling back to Direct Connection for DOM execution...`);
        if (recorder) { await recorder.stop().catch(() => {}); recorder = null; }
        await browser.close();
        activeProxy = null;
        browser = await launchBrowser(null);
        const res = await setupPage(browser);
        page = res.page;
        getGaCount = res.getGaCount;

        if (videoPath) {
          recorder = new PuppeteerScreenRecorder(page, { fps: 25, aspectRatio: '16:9' });
          await recorder.start(videoPath).catch(() => { recorder = null; });
        }

        try {
          await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 7000 });
          const directIp = await page.evaluate(() => document.body.innerText);
          console.log(`✅ Direct Local IP: ${directIp.trim()}`);
        } catch (e) {
          // Continue anyway
        }
      }
    }

    // Step 3: Navigate to target website with Full JS Execution & GA Event Capture
    console.log(`🎯 Navigating to target site with DOM & JS execution: ${targetUrl}...`);
    const startTime = Date.now();
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 35000 }).catch(async () => {
      return await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`📊 Page Load Status: ${response?.status() || 200} (${duration}s)`);
    console.log(`📄 Page Title: "${await page.title()}"`);

    // Step 4: Engagement & Active Stay for GA4 Session Tracking
    console.log(`⏱️ Simulating 10s engaged session (scrolling, focus, mouse movements for GA4)...`);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 150);
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('mousemove'));
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`📈 GA Tracking Summary: Captured ${getGaCount()} GA network beacon events!`);
    console.log(`✨ Session completed successfully!`);

  } catch (error) {
    console.error(`❌ Error during browser session:`, error.message);
  } finally {
    if (recorder) {
      try {
        await recorder.stop();
        console.log(`🎬 Saved MP4 Video Artifact: ${videoPath}`);
      } catch (e) {
        // Ignore
      }
    }
    if (browser) await browser.close();
  }
}

// Execute standalone if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || 'https://justpasteit.in/';
  const headlessArg = process.argv.includes('--headless');
  runTorSession(target, 'socks5://127.0.0.1:9050', null, { headless: headlessArg, enableFallback: true, recordVideo: true });
}
