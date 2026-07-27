import puppeteer from 'puppeteer-core';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurations
const SEARCH_CONFIG_PATH = path.join(__dirname, 'search_config.json');
const GENERAL_CONFIG_PATH = path.join(__dirname, 'config.json');

let config = {
  searchEngine: 'https://www.google.com',
  searchKeyword: process.env.SEARCH_KEYWORD || 'just paste it',
  targetDomain: process.env.TARGET_DOMAIN || 'justpasteit.in',
  targetUrl: process.env.TARGET_URL || 'http://justpasteit.in/',
  maxSerpPages: parseInt(process.env.MAX_SERP_PAGES || '3', 10),
  totalVisits: parseInt(process.env.TOTAL_VISITS || '10', 10),
  concurrency: parseInt(process.env.CONCURRENCY || '2', 10),
  minDwellTime: parseInt(process.env.MIN_DWELL || '15', 10),
  maxDwellTime: parseInt(process.env.MAX_DWELL || '30', 10),
  headless: process.env.HEADLESS !== 'false',
  proxies: []
};

// Load search_config.json if available
if (fs.existsSync(SEARCH_CONFIG_PATH)) {
  try {
    const searchData = JSON.parse(fs.readFileSync(SEARCH_CONFIG_PATH, 'utf8'));
    config = { ...config, ...searchData };
  } catch (e) {
    console.error('⚠️ Could not load search_config.json:', e.message);
  }
}

// Fallback proxies from config.json if search config proxies is empty
if ((!config.proxies || config.proxies.length === 0) && fs.existsSync(GENERAL_CONFIG_PATH)) {
  try {
    const generalData = JSON.parse(fs.readFileSync(GENERAL_CONFIG_PATH, 'utf8'));
    if (generalData.proxies && generalData.proxies.length > 0) {
      config.proxies = generalData.proxies;
    }
  } catch (e) {}
}

// Re-apply env overrides if explicitly specified
if (process.env.SEARCH_KEYWORD) config.searchKeyword = process.env.SEARCH_KEYWORD;
if (process.env.TARGET_DOMAIN) config.targetDomain = process.env.TARGET_DOMAIN;
if (process.env.TARGET_URL) config.targetUrl = process.env.TARGET_URL;
if (process.env.TOTAL_VISITS) config.totalVisits = parseInt(process.env.TOTAL_VISITS, 10);
if (process.env.CONCURRENCY) config.concurrency = parseInt(process.env.CONCURRENCY, 10);
if (process.env.MIN_DWELL) config.minDwellTime = parseInt(process.env.MIN_DWELL, 10);
if (process.env.MAX_DWELL) config.maxDwellTime = parseInt(process.env.MAX_DWELL, 10);
if (process.env.HEADLESS) config.headless = process.env.HEADLESS !== 'false';

function log(msg, type = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const icon = type === 'SUCCESS' ? '✅' : type === 'WARNING' ? '⚠️' : type === 'ERROR' ? '❌' : 'ℹ️';
  console.log(`[${time}] ${icon} [${type}] ${msg}`);
}

function getChromeExecutablePath() {
  const envPath = process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return envPath || '/usr/bin/google-chrome';
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

const locationProfiles = [
  { name: 'New York, US', timezone: 'America/New_York', lat: 40.7128, lng: -74.0060, lang: 'en-US,en;q=0.9' },
  { name: 'London, UK', timezone: 'Europe/London', lat: 51.5074, lng: -0.1278, lang: 'en-GB,en;q=0.9' },
  { name: 'Tokyo, Japan', timezone: 'Asia/Tokyo', lat: 35.6762, lng: 139.6503, lang: 'ja-JP,ja;q=0.9,en-US;q=0.8' },
  { name: 'Toronto, Canada', timezone: 'America/Toronto', lat: 43.6532, lng: -79.3832, lang: 'en-CA,en;q=0.9' }
];

let visitsCompleted = 0;
let visitsFailed = 0;

async function runWorker(workerIndex) {
  const workerId = `W${workerIndex}-${uuidv4().slice(0, 5)}`;
  log(`[${workerId}] Launching worker session...`);

  let browser = null;

  try {
    const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    let proxyArgs = [];
    let proxyAuth = null;

    if (config.proxies && config.proxies.length > 0) {
      const rawProxy = config.proxies[Math.floor(Math.random() * config.proxies.length)].trim();
      if (rawProxy) {
        try {
          let urlStr = rawProxy;
          if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://') && !urlStr.startsWith('socks5://')) {
            urlStr = 'http://' + urlStr;
          }
          const url = new URL(urlStr);
          proxyArgs.push(`--proxy-server=${url.protocol}//${url.host}`);
          if (url.username && url.password) {
            proxyAuth = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
          }
          log(`[${workerId}] Proxy attached: ${url.host}`);
        } catch (e) {
          log(`[${workerId}] Invalid proxy format: ${rawProxy}`, 'WARNING');
        }
      }
    }

    const chromePath = getChromeExecutablePath();
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        ...proxyArgs
      ]
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    await page.setUserAgent(userAgent);

    // Emulate Location & Timezone
    const targetLoc = locationProfiles[Math.floor(Math.random() * locationProfiles.length)];
    try {
      await page.emulateTimezone(targetLoc.timezone);
      await page.setExtraHTTPHeaders({ 'Accept-Language': targetLoc.lang });
      const cdpSession = await page.target().createCDPSession();
      await cdpSession.send('Emulation.setGeolocationOverride', {
        latitude: targetLoc.lat,
        longitude: targetLoc.lng,
        accuracy: 100
      });
    } catch (e) {}

    // Stealth Script to Bypass GA4 Bot Filters & WebDriver detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefoxmcalj' }
        ]
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // 1. Navigate to Google Search
    log(`[${workerId}] Navigating to Google Search (${config.searchEngine})...`);
    await page.goto(config.searchEngine, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await new Promise(r => setTimeout(r, 2000));

    // 2. Handle Google Consent Banner if shown
    log(`[${workerId}] Checking for Google Privacy/Consent banners...`);
    try {
      const consentClicked = await page.evaluate(() => {
        // Try common Google consent button IDs & text
        const consentIds = ['#L2AGLb', '#bNP41b', '#VC338e'];
        for (const id of consentIds) {
          const btn = document.querySelector(id);
          if (btn) {
            btn.click();
            return true;
          }
        }
        // Fallback: search for buttons containing "Accept all", "I agree", or "Agree"
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const targetBtn = buttons.find(b => {
          const text = (b.innerText || '').trim().toLowerCase();
          return text === 'accept all' || text === 'i agree' || text === 'agree' || text.includes('accept all');
        });
        if (targetBtn) {
          targetBtn.click();
          return true;
        }
        return false;
      });

      if (consentClicked) {
        log(`[${workerId}] Google Cookie Consent banner accepted.`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {}

    // 3. Find Search Box and Type Keyword
    log(`[${workerId}] Typing search query: "${config.searchKeyword}"...`);
    const searchSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchSelector, { timeout: 15000 });
    
    await page.focus(searchSelector);
    // Type character by character with human-like random delay
    for (const char of config.searchKeyword) {
      await page.type(searchSelector, char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
    await new Promise(r => setTimeout(r, 800));

    // Submit Search
    log(`[${workerId}] Submitting Google search...`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.keyboard.press('Enter')
    ]);

    log(`[${workerId}] SERP Page 1 loaded. Searching for target domain: ${config.targetDomain}...`);

    let targetFound = false;
    let pageCount = 1;

    while (pageCount <= config.maxSerpPages && !targetFound) {
      log(`[${workerId}] Scanning SERP Page ${pageCount}...`);

      // Evaluate page links matching target domain or target URL
      const matchingLink = await page.evaluateHandle((domain, targetUrl) => {
        const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
        // Search all anchor tags in result container or main page
        const links = Array.from(document.querySelectorAll('#search a[href], #rso a[href], div.g a[href], #main a[href], a[href]'));

        for (const a of links) {
          const href = (a.href || '').toLowerCase();
          // Filter out google internal, google cache, maps, youtube, privacy links
          if (
            href.includes('google.com') ||
            href.includes('googleusercontent.com') ||
            href.includes('gstatic.com') ||
            href.includes('accounts.google')
          ) {
            continue;
          }
          if (href.includes(cleanDomain) || (targetUrl && href.includes(targetUrl.toLowerCase()))) {
            return a;
          }
        }
        return null;
      }, config.targetDomain, config.targetUrl);

      const linkElement = matchingLink.asElement();

      if (linkElement) {
        targetFound = true;
        log(`[${workerId}] 🎯 Target link located on SERP Page ${pageCount}!`, 'SUCCESS');

        // Scroll link into center view
        await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), linkElement);
        await new Promise(r => setTimeout(r, 1500));

        // Click target link
        log(`[${workerId}] Clicking target link...`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}),
          linkElement.click()
        ]);
        break;
      } else {
        log(`[${workerId}] Target domain not found on SERP Page ${pageCount}.`);
        if (pageCount < config.maxSerpPages) {
          // Look for Next Page button (#pnnext or aria-label or a containing start=)
          const hasNext = await page.evaluate(() => {
            const selectors = [
              '#pnnext',
              'a[id="pnnext"]',
              'a[aria-label="Next page"]',
              'a[aria-label*="Next"]',
              'td.b a',
              'a[href*="start="]'
            ];
            for (const s of selectors) {
              const nextBtn = document.querySelector(s);
              if (nextBtn) {
                nextBtn.click();
                return true;
              }
            }
            return false;
          });

          if (hasNext) {
            log(`[${workerId}] Navigating to SERP Page ${pageCount + 1}...`);
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
            pageCount++;
          } else {
            log(`[${workerId}] No "Next" button found on SERP. Stopping pagination.`, 'WARNING');
            break;
          }
        } else {
          break;
        }
      }
    }

    if (!targetFound) {
      log(`[${workerId}] Target domain "${config.targetDomain}" not found directly on SERP. Fallback to organic Google referrer navigation...`, 'WARNING');
      const gotoOptions = { waitUntil: 'domcontentloaded', timeout: 35000, referrer: 'https://www.google.com/' };
      await page.goto(config.targetUrl, gotoOptions);
      targetFound = true;
    }

    // 4. Target Site Landed & Dwell Simulation
    const currentUrl = page.url();
    log(`[${workerId}] Successfully landed on target page: ${currentUrl}`, 'SUCCESS');

    // Simulate human mouse scroll down/up
    log(`[${workerId}] Simulating human browsing behavior...`);
    try {
      await page.mouse.move(300, 400);
      await page.mouse.move(600, 500);
    } catch (e) {}

    await page.evaluate(async () => {
      await new Promise(resolve => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 120);
          total += 120;
          if (total >= document.body.scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });

    const dwellSec = Math.floor(Math.random() * (config.maxDwellTime - config.minDwellTime + 1)) + config.minDwellTime;
    log(`[${workerId}] Dwelling on target page for ${dwellSec} seconds...`);
    await new Promise(r => setTimeout(r, dwellSec * 1000));

    visitsCompleted++;
    log(`[${workerId}] Visit completed successfully! (Total completed: ${visitsCompleted})`, 'SUCCESS');

  } catch (err) {
    visitsFailed++;
    log(`[${workerId}] Worker error: ${err.message}`, 'ERROR');
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('🚀 ORGANIC GOOGLE SEARCH TRAFFIC SIMULATOR');
  console.log('====================================================');
  console.log(`Keyword:        "${config.searchKeyword}"`);
  console.log(`Target Domain:  "${config.targetDomain}"`);
  console.log(`Target URL:     "${config.targetUrl}"`);
  console.log(`Total Visits:   ${config.totalVisits}`);
  console.log(`Concurrency:    ${config.concurrency}`);
  console.log(`Dwell Range:    ${config.minDwellTime}s - ${config.maxDwellTime}s`);
  console.log(`Headless:       ${config.headless}`);
  console.log('====================================================\n');

  let remaining = config.totalVisits;
  let workerCounter = 0;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, config.concurrency);
    log(`Starting batch of ${batchSize} worker(s)... (${remaining} remaining)`);

    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      workerCounter++;
      promises.push(runWorker(workerCounter));
    }

    await Promise.all(promises);
    remaining -= batchSize;

    if (remaining > 0) {
      log('Batch finished. Pausing briefly before next batch...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n====================================================');
  console.log('🏁 SIMULATION SUMMARY');
  console.log(`Visits Completed: ${visitsCompleted}`);
  console.log(`Visits Failed:    ${visitsFailed}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
