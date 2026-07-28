import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'fs';
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
        // Pick first remote proxy (excluding 127.0.0.1 / localhost)
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
 * Runs a single Puppeteer session through Tor or Proxy with Visible UI Mode
 * @param {string} targetUrl - Webpage to visit
 * @param {string} socksProxy - Tor SOCKS5 proxy endpoint (default: socks5://127.0.0.1:9050)
 * @param {{username?: string, password?: string}} [auth] - Optional proxy auth
 * @param {{headless?: boolean, enableFallback?: boolean}} [options] - Configuration options
 */
export async function runTorSession(
  targetUrl = 'https://ustpasteit.in/',
  socksProxy = 'socks5://127.0.0.1:9050',
  auth = null,
  options = { headless: false, enableFallback: true }
) {
  const isHeadless = options.headless ?? false;
  console.log(`\n---------------------------------------------------`);
  console.log(`🖥️ Launching Browser UI (Headless: ${isHeadless})...`);
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
      headless: isHeadless, // false = opens real Chrome window UI!
      ignoreHTTPSErrors: true,
      defaultViewport: null,
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

  try {
    let page = await browser.newPage();

    if (auth && auth.username && activeProxy === socksProxy) {
      await page.authenticate({ username: auth.username, password: auth.password }).catch(() => { });
    }

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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
        await browser.close();
        activeProxy = fallback;
        browser = await launchBrowser(activeProxy);
        page = await browser.newPage();
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

      // Final fallback: Direct Connection for smooth local UI testing
      if (!connectionSuccess) {
        console.log(`🌐 Falling back to Direct Local Connection for UI demonstration...`);
        await browser.close();
        activeProxy = null;
        browser = await launchBrowser(null);
        page = await browser.newPage();
        try {
          await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 7000 });
          const directIp = await page.evaluate(() => document.body.innerText);
          console.log(`✅ Direct Local IP: ${directIp.trim()}`);
        } catch (e) {
          // Continue anyway
        }
      }
    }

    // Step 3: Navigate to target website in Chrome UI window
    console.log(`🎯 Navigating to target site in Chrome UI: ${targetUrl}...`);
    const startTime = Date.now();
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`📊 Page Load Status: ${response?.status() || 200} (${duration}s)`);
    console.log(`📄 Page Title: "${await page.title()}"`);

    // Step 4: Simulate realistic human engagement visible on screen
    console.log(`⏱️ Demonstrating visual human engagement (scrolling down & mouse movements)...`);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 200));
      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`✨ Visual session completed successfully! Keeping UI open for 3 seconds...`);
    await new Promise(r => setTimeout(r, 3000));

  } catch (error) {
    console.error(`❌ Error during browser session:`, error.message);
  } finally {
    if (browser) await browser.close();
  }
}

// Execute standalone if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || 'https://ustpasteit.in/';
  const headlessArg = process.argv.includes('--headless');
  runTorSession(target, 'socks5://127.0.0.1:9050', null, { headless: headlessArg, enableFallback: true });
}
