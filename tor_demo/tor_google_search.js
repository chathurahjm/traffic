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
 * Executes an Organic Google Search -> Click Result -> Engaged Target Session via Tor
 * @param {string} keyword - Google search keyword (e.g. 'just paste it')
 * @param {string} targetDomain - Target domain to find & click (e.g. 'justpasteit.in')
 * @param {string} socksProxy - Tor SOCKS5 proxy endpoint (default: socks5://127.0.0.1:9050)
 * @param {{username?: string, password?: string}} [auth] - Optional proxy auth
 * @param {{headless?: boolean, enableFallback?: boolean, recordVideo?: boolean}} [options] - Configuration options
 */
export async function runOrganicTorSearchSession(
  keyword = 'just paste it',
  targetDomain = 'justpasteit.in',
  socksProxy = 'socks5://127.0.0.1:9050',
  auth = null,
  options = { headless: false, enableFallback: true, recordVideo: true }
) {
  const isHeadless = options.headless ?? false;
  console.log(`\n===================================================`);
  console.log(`🔍 Organic Google Search Session via Tor SOCKS5`);
  console.log(`🔑 Keyword: "${keyword}"`);
  console.log(`🎯 Target Domain: "${targetDomain}"`);
  console.log(`🖥️ Mode: Headless ${isHeadless}`);
  console.log(`===================================================`);

  const executablePath = findBrowserExecutable();
  console.log(`📍 Browser Binary: ${executablePath}`);

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

    // Stealth: Override navigator.webdriver
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // GA Event Monitoring
    let gaEventsCount = 0;
    p.on('request', (req) => {
      const u = req.url();
      if (u.includes('google-analytics.com') || u.includes('analytics.google.com') || u.includes('/g/collect')) {
        gaEventsCount++;
        console.log(`📊 [GA Event Dispatched] -> ${u.substring(0, 85)}...`);
      }
    });

    return { page: p, getGaCount: () => gaEventsCount };
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
        videoPath = path.join(videosDir, `organic_search_${Date.now()}.mp4`);
        recorder = new PuppeteerScreenRecorder(page, { fps: 25, aspectRatio: '16:9' });
        await recorder.start(videoPath);
        console.log(`🎥 Video Recording Started: ${videoPath}`);
      } catch (recErr) {
        recorder = null;
      }
    }

    // Step 1: Proxy Availability Check
    console.log(`🌐 Testing network connection via api.ipify.org...`);
    let connectionSuccess = false;
    try {
      await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 7000 });
      const ipText = await page.evaluate(() => document.body.innerText);
      if (ipText && !ipText.includes('ERR_')) {
        console.log(`✅ Outgoing IP: ${ipText.trim()}`);
        connectionSuccess = true;
      }
    } catch (err) {
      console.warn(`⚠️ Primary proxy (${activeProxy}) is unavailable on local network.`);
    }

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
          console.warn(`⚠️ Fallback proxy timed out.`);
        }
      }

      if (!connectionSuccess) {
        console.log(`🌐 Falling back to Direct Connection for search flow...`);
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
      }
    }

    // Step 2: Navigate to Google Search
    console.log(`🌐 Navigating to Google Search (https://www.google.com)...`);
    await page.goto('https://www.google.com', { waitUntil: 'networkidle2', timeout: 35000 });

    // Handle Google Consent Dialog if present
    try {
      const consentButton = await page.$('button[id*="L2AGLb"], #L2AGLb, button:has-text("Accept all")');
      if (consentButton) {
        console.log(`🍪 Dismissing Google Consent Dialog...`);
        await consentButton.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {}

    // Step 3: Type Search Keyword
    console.log(`⌨️ Searching for keyword: "${keyword}"...`);
    const searchBoxSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchBoxSelector, { timeout: 15000 });
    await page.click(searchBoxSelector);
    await page.type(searchBoxSelector, keyword, { delay: 80 });
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');

    console.log(`⏳ Waiting for Google Search Results...`);
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

    // Step 4: Find & Click Target Result
    console.log(`🔍 Scanning search results for target domain: "${targetDomain}"...`);
    
    // Find matching link
    const targetLink = await page.evaluateHandle((domain) => {
      const anchors = Array.from(document.querySelectorAll('a'));
      return anchors.find(a => a.href && a.href.includes(domain));
    }, targetDomain);

    const linkElement = targetLink.asElement();

    if (linkElement) {
      console.log(`🎯 Found matching search result for "${targetDomain}"! Clicking...`);
      await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), linkElement);
      await new Promise(r => setTimeout(r, 1000));
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {}),
        linkElement.click()
      ]);

      console.log(`✅ Arrived at Target Page: "${await page.title()}" (${page.url()})`);

      // Step 5: Engagement & GA Session Tracking
      console.log(`⏱️ Simulating 10s engaged session on target page for GA tracking...`);
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, 180);
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('mousemove'));
        });
        await new Promise(r => setTimeout(r, 2000));
      }

      console.log(`📈 Organic Search GA Summary: Dispatched ${getGaCount()} GA tracking events!`);
    } else {
      console.warn(`⚠️ Could not locate domain "${targetDomain}" on first page of Google search results.`);
      console.log(`🔗 Navigating directly to target site fallback...`);
      await page.goto(`http://${targetDomain}/`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }

    console.log(`✨ Organic Search Session completed successfully!`);

  } catch (error) {
    console.error(`❌ Error during organic search session:`, error.message);
  } finally {
    if (recorder) {
      try {
        await recorder.stop();
        console.log(`🎬 Saved MP4 Video Artifact: ${videoPath}`);
      } catch (e) {}
    }
    if (browser) await browser.close();
  }
}

// Execute standalone if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const keyword = process.argv[2] || 'just paste it';
  const domain = process.argv[3] || 'justpasteit.in';
  const headlessArg = process.argv.includes('--headless');
  runOrganicTorSearchSession(keyword, domain, 'socks5://127.0.0.1:9050', null, { headless: headlessArg, enableFallback: true, recordVideo: true });
}
