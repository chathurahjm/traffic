import puppeteerCore from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// Enable stealth plugin
puppeteerExtra.use(StealthPlugin());

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
 * Gets a fresh list of proxies from search_config.json or config.json
 */
function getProxyList() {
  const proxies = [];
  try {
    const configPath = path.resolve('../search_config.json');
    const rootConfigPath = path.resolve('../config.json');
    
    let fileToRead = existsSync(configPath) ? configPath : (existsSync(rootConfigPath) ? rootConfigPath : null);
    if (fileToRead) {
      const data = JSON.parse(readFileSync(fileToRead, 'utf8'));
      if (Array.isArray(data.proxies) && data.proxies.length > 0) {
        data.proxies.forEach(p => {
          if (!p.includes('127.0.0.1') && !p.includes('localhost')) {
            const formatted = p.startsWith('socks5://') || p.startsWith('http://') || p.startsWith('https://') ? p : `socks5://${p}`;
            proxies.push(formatted);
          }
        });
      }
    }
  } catch (e) {
    // Ignore
  }
  return proxies;
}

function getFallbackProxy(excludeProxies = []) {
  const list = getProxyList();
  const available = list.filter(p => !excludeProxies.includes(p));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  return null;
}

/**
 * Parses proxy URL strings to separate proxy server address from embedded credentials
 */
function parseProxyDetails(rawProxyUrl, explicitAuth = null) {
  if (!rawProxyUrl) return { proxyServer: null, auth: explicitAuth };
  let proxyServer = rawProxyUrl;
  let auth = explicitAuth ? { ...explicitAuth } : null;

  try {
    let urlString = rawProxyUrl;
    if (!urlString.includes('://')) {
      urlString = `http://${urlString}`;
    }
    const parsed = new URL(urlString);
    if (parsed.username || parsed.password) {
      auth = auth || {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
      };
      parsed.username = '';
      parsed.password = '';
      proxyServer = parsed.toString().replace(/\/$/, '');
    } else {
      proxyServer = urlString;
    }
  } catch (e) {
    proxyServer = rawProxyUrl;
  }
  return { proxyServer, auth };
}

/**
 * Executes an Organic Google Search -> Click Result -> Engaged Target Session via Proxy or Tor
 * @param {string} keyword - Google search keyword (e.g. 'just paste it')
 * @param {string} targetDomain - Target domain to find & click (e.g. 'justpasteit.in')
 * @param {string} socksProxy - Proxy endpoint URL (e.g. http://1.2.3.4:8080, socks5://127.0.0.1:9050)
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
  const parsedProxy = parseProxyDetails(socksProxy, auth);
  let activeProxy = parsedProxy.proxyServer;
  let activeAuth = parsedProxy.auth;

  console.log(`\n===================================================`);
  console.log(`🔍 Organic Google Search Session via Proxy / Tor`);
  console.log(`🔑 Keyword: "${keyword}"`);
  console.log(`🎯 Target Domain: "${targetDomain}"`);
  console.log(`🌐 Proxy: ${activeProxy || 'Direct Connection'}`);
  console.log(`🖥️ Mode: Headless ${isHeadless}`);
  console.log(`===================================================`);

  const executablePath = findBrowserExecutable();
  console.log(`📍 Browser Binary: ${executablePath}`);

  const launchBrowser = async (proxyUrl) => {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--window-size=1366,768',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ];
    if (proxyUrl) {
      launchArgs.push(`--proxy-server=${proxyUrl}`);
    }

    return await puppeteerExtra.launch({
      executablePath,
      headless: isHeadless,
      ignoreHTTPSErrors: true,
      ignoreDefaultArgs: ['--enable-automation'],
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

    // Comprehensive stealth: Override all bot-detection signals
    await p.evaluateOnNewDocument(() => {
      // 1. Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      // 2. Fake plugins array (real Chrome has plugins)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ]
      });

      // 3. Fake languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // 4. Fake platform
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

      // 5. Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      // 6. Fake chrome runtime (headless Chrome is missing this)
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };

      // 7. Override toString to hide modified functions
      const fnToStr = Function.prototype.toString;
      const proxyHandler = {
        apply: function (target, thisArg, args) {
          if (args[0] === navigator.permissions.query) {
            return 'function query() { [native code] }';
          }
          return fnToStr.call(args[0]);
        }
      };
      // Safe: only wrap if not already proxied
      try { Function.prototype.toString = new Proxy(fnToStr, proxyHandler); } catch (e) {}
    });

    await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    // Set realistic headers
    await p.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

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

  /**
   * Detects and attempts to handle human verification challenges
   * (Google reCAPTCHA checkbox, Cloudflare Turnstile, consent pages)
   */
  const handleHumanVerification = async (page) => {
    console.log(`🔍 Checking for human verification challenges...`);
    await new Promise(r => setTimeout(r, 2000)); // Wait for any challenge to render

    // Check page content for verification indicators
    const pageContent = await page.content().catch(() => '');
    const pageUrl = page.url();

    const isVerificationPage = 
      pageContent.includes('recaptcha') ||
      pageContent.includes('g-recaptcha') ||
      pageContent.includes('captcha') ||
      pageContent.includes('verify you are human') ||
      pageContent.includes('are you a robot') ||
      pageContent.includes('unusual traffic') ||
      pageContent.includes('cf-turnstile') ||
      pageContent.includes('challenge-platform') ||
      pageUrl.includes('/sorry/') ||   // Google's CAPTCHA page
      pageUrl.includes('consent.google');

    if (!isVerificationPage) {
      console.log(`✅ No verification challenge detected.`);
      return false;
    }

    console.log(`⚠️ Human verification page detected! URL: ${pageUrl}`);
    console.log(`🤖 Attempting to solve verification...`);

    // Strategy 1: Try clicking reCAPTCHA checkbox inside iframe
    try {
      const recaptchaFrame = await page.$('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]');
      if (recaptchaFrame) {
        console.log(`🔲 Found reCAPTCHA iframe — attempting checkbox click...`);
        const frame = await recaptchaFrame.contentFrame();
        if (frame) {
          // Human-like delay before clicking
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
          const checkbox = await frame.$('.recaptcha-checkbox-border, #recaptcha-anchor, .rc-anchor-checkbox');
          if (checkbox) {
            // Move mouse naturally to the checkbox area
            const box = await checkbox.boundingBox();
            if (box) {
              await page.mouse.move(
                box.x + box.width / 2 + (Math.random() * 10 - 5),
                box.y + box.height / 2 + (Math.random() * 10 - 5),
                { steps: 10 + Math.floor(Math.random() * 10) }
              );
              await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            }
            await checkbox.click();
            console.log(`✅ Clicked reCAPTCHA checkbox!`);
            await new Promise(r => setTimeout(r, 3000)); // Wait for verification
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            return true;
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ reCAPTCHA iframe attempt failed: ${e.message}`);
    }

    // Strategy 2: Try clicking Cloudflare Turnstile checkbox
    try {
      const turnstileFrame = await page.$('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
      if (turnstileFrame) {
        console.log(`🔲 Found Cloudflare Turnstile — attempting click...`);
        const frame = await turnstileFrame.contentFrame();
        if (frame) {
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
          const checkbox = await frame.$('input[type="checkbox"], .cb-i, label');
          if (checkbox) {
            await checkbox.click();
            console.log(`✅ Clicked Turnstile checkbox!`);
            await new Promise(r => setTimeout(r, 4000));
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            return true;
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ Turnstile attempt failed: ${e.message}`);
    }

    // Strategy 3: Try clicking any visible "verify" / "I'm not a robot" button on the page itself
    try {
      const verifyClicked = await page.evaluate(() => {
        const selectors = [
          'button[id*="verify"]', 'button[id*="submit"]',
          'input[type="submit"][value*="Verify"]',
          'input[type="submit"][value*="Submit"]',
          'a[href*="verify"]',
          '#challenge-form button', '#challenge-form input[type="submit"]',
          'button:not([disabled])'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            el.click();
            return sel;
          }
        }
        return null;
      });
      if (verifyClicked) {
        console.log(`✅ Clicked page-level verify button: ${verifyClicked}`);
        await new Promise(r => setTimeout(r, 3000));
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        return true;
      }
    } catch (e) {
      console.log(`⚠️ Page-level verify attempt failed: ${e.message}`);
    }

    console.log(`❌ Could not automatically solve verification challenge.`);
    console.log(`📸 Taking screenshot of verification page for debugging...`);
    try {
      const screenshotPath = path.resolve('./videos', `verification_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (e) {}
    return false;
  };

  try {
    let { page, getGaCount } = await setupPage(browser);
    
    if (activeAuth && activeAuth.username) {
      await page.authenticate({ username: activeAuth.username, password: activeAuth.password }).catch(() => {});
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

    // Wait for results to fully render (Google loads results dynamically)
    await new Promise(r => setTimeout(r, 2500));

    // Check for Google CAPTCHA/verification before scanning results
    const googleVerification = await handleHumanVerification(page);
    if (googleVerification) {
      console.log(`📍 Passed Google verification, now on: ${page.url()}`);
      await new Promise(r => setTimeout(r, 2000)); // Wait for results after verification
    }

    // Step 4: Find & Click Target Result
    console.log(`🔍 Scanning search results for target domain: "${targetDomain}"...`);
    
    // Find matching link — use precise matching to avoid confusing justpaste.it with justpasteit.in
    const targetLink = await page.evaluateHandle((domain) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      // First pass: exact domain match in href (e.g. justpasteit.in/ but NOT justpaste.it)
      const exactMatch = anchors.find(a => {
        try {
          const url = new URL(a.href);
          return url.hostname === domain || url.hostname === 'www.' + domain;
        } catch { return false; }
      });
      if (exactMatch) return exactMatch;
      // Fallback: substring match
      return anchors.find(a => a.href && a.href.includes(domain));
    }, targetDomain);

    const linkElement = targetLink.asElement();

    if (linkElement) {
      console.log(`🎯 Found matching search result for "${targetDomain}"! Clicking...`);
      await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), linkElement);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {}),
        linkElement.click()
      ]);

      console.log(`📍 Page after click: "${await page.title()}" (${page.url()})`);

      // Step 5: Handle Human Verification if present
      const hadVerification = await handleHumanVerification(page);
      if (hadVerification) {
        console.log(`📍 Page after verification: "${await page.title()}" (${page.url()})`);
      }

      // Check if we actually landed on the target domain
      const currentUrl = page.url();
      if (!currentUrl.includes(targetDomain)) {
        console.warn(`⚠️ Still not on target domain after verification. Current: ${currentUrl}`);
        console.log(`🔗 Falling back to direct navigation...`);
        await page.goto(`https://${targetDomain}/`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      }

      console.log(`✅ Arrived at Target Page: "${await page.title()}" (${page.url()})`);

      // Step 6: Engagement & GA Session Tracking
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
      await page.goto(`https://${targetDomain}/`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
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

// Parse CLI arguments
function parseCLIArgs(argv) {
  const args = argv.slice(2);
  let keyword = null;
  let domain = null;
  let proxy = null;
  let proxyUser = null;
  let proxyPass = null;
  let headless = false;
  let enableFallback = true;
  let recordVideo = true;

  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headless') {
      headless = true;
    } else if (arg === '--no-fallback' || arg === '--disable-fallback') {
      enableFallback = false;
    } else if (arg === '--no-video' || arg === '--disable-video') {
      recordVideo = false;
    } else if (arg.startsWith('--keyword=')) {
      keyword = arg.split('=').slice(1).join('=');
    } else if (arg === '--keyword' && i + 1 < args.length) {
      keyword = args[++i];
    } else if (arg.startsWith('--domain=')) {
      domain = arg.split('=').slice(1).join('=');
    } else if (arg === '--domain' && i + 1 < args.length) {
      domain = args[++i];
    } else if (arg.startsWith('--proxy=')) {
      proxy = arg.split('=').slice(1).join('=');
    } else if (arg === '--proxy' && i + 1 < args.length) {
      proxy = args[++i];
    } else if (arg.startsWith('--proxy-user=')) {
      proxyUser = arg.split('=').slice(1).join('=');
    } else if (arg === '--proxy-user' && i + 1 < args.length) {
      proxyUser = args[++i];
    } else if (arg.startsWith('--proxy-pass=')) {
      proxyPass = arg.split('=').slice(1).join('=');
    } else if (arg === '--proxy-pass' && i + 1 < args.length) {
      proxyPass = args[++i];
    } else if (!arg.startsWith('--')) {
      positionals.push(arg);
    }
  }

  if (!keyword) keyword = positionals[0] || 'just paste it';
  if (!domain) domain = positionals[1] || 'justpasteit.in';
  if (!proxy) proxy = 'socks5://127.0.0.1:9050';

  let auth = null;
  if (proxyUser || proxyPass) {
    auth = { username: proxyUser || '', password: proxyPass || '' };
  }

  return { keyword, domain, proxy, auth, options: { headless, enableFallback, recordVideo } };
}

// Execute standalone if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { keyword, domain, proxy, auth, options } = parseCLIArgs(process.argv);
  runOrganicTorSearchSession(keyword, domain, proxy, auth, options);
}
