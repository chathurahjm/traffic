import { chromium } from 'patchright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load authenticated session state (Playwright/Patchright storageState)
 */
function getStorageStatePath() {
  const possiblePaths = [
    path.resolve(__dirname, '../youtube/auth_state.json'),
    path.resolve(__dirname, 'youtube/auth_state.json'),
    path.resolve(__dirname, 'auth_state.json'),
    path.resolve('youtube/auth_state.json'),
    path.resolve('auth_state.json')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`🔑 Loaded authenticated Google session from: ${p}`);
      return p;
    }
  }

  if (process.env.AUTH_STATE_JSON) {
    try {
      const parsed = JSON.parse(process.env.AUTH_STATE_JSON);
      const tmpPath = path.resolve(__dirname, 'temp_auth_state.json');
      fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), 'utf8');
      console.log(`🔑 Created and loaded authenticated session from AUTH_STATE_JSON secret.`);
      return tmpPath;
    } catch (e) {
      console.warn(`⚠️ Failed to parse AUTH_STATE_JSON secret: ${e.message}`);
    }
  }

  return undefined;
}

/**
 * Detects and handles consent dialogs or verification prompts (with Buster integration)
 */
async function handlePopupsAndVerification(page) {
  try {
    // 1. Consent buttons
    const consentSelectors = [
      'button#L2AGLb',
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      'button[aria-label*="Accept"]',
      'form[action*="consent"] button'
    ];
    for (const selector of consentSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`🍪 Dismissing Google consent prompt (${selector})...`);
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
        break;
      }
    }

    // 2. reCAPTCHA checkbox detection
    const recaptchaFrame = page.frameLocator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]').first();
    const checkbox = recaptchaFrame.locator('.recaptcha-checkbox-border, #recaptcha-anchor, .rc-anchor-checkbox').first();
    if (await checkbox.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`🔲 Found reCAPTCHA checkbox — attempting click...`);
      await page.waitForTimeout(1000 + Math.random() * 1500);
      await checkbox.click().catch(() => {});
      await page.waitForTimeout(3000);
    }

    // 3. Buster: Captcha Solver for Humans button click in reCAPTCHA challenge frame
    const challengeFrame = page.frameLocator('iframe[title*="challenge"], iframe[src*="bframe"]').first();
    const busterButton = challengeFrame.locator('#solver-button, .buster-button, .rc-button-solver').first();
    if (await busterButton.isVisible({ timeout: 2500 }).catch(() => false)) {
      console.log(`⚡ Found Buster CAPTCHA Solver button — triggering solver...`);
      await page.waitForTimeout(1000 + Math.random() * 1000);
      await busterButton.click().catch(() => {});
      console.log(`⏳ Buster solver triggered, waiting for automated verification...`);
      await page.waitForTimeout(5000);
    } else {
      // Fallback: Click native audio challenge button if Buster button not yet rendered
      const audioButton = challengeFrame.locator('#recaptcha-audio-button, button.rc-button-audio').first();
      if (await audioButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`🎙️ Found reCAPTCHA audio challenge button — clicking...`);
        await page.waitForTimeout(1000 + Math.random() * 1000);
        await audioButton.click().catch(() => {});
        await page.waitForTimeout(3000);

        // Check again if Buster solver button appeared inside audio frame
        if (await busterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`⚡ Clicking Buster solver button on audio challenge...`);
          await busterButton.click().catch(() => {});
          await page.waitForTimeout(5000);
        }
      }
    }

    // 4. Cloudflare Turnstile iframe detection
    const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').first();
    const turnstileBox = turnstileFrame.locator('input[type="checkbox"], .cb-i, label').first();
    if (await turnstileBox.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`🔲 Found Turnstile checkbox — attempting click...`);
      await page.waitForTimeout(1000 + Math.random() * 1500);
      await turnstileBox.click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    // Ignore verification handler errors
  }
}

/**
 * Executes an Organic Google Search -> Click Result -> Engaged Target Session using Patchright with Buster
 * @param {string} keyword - Google search keyword (e.g. 'just paste it')
 * @param {string} targetDomain - Target domain to find & click (e.g. 'justpasteit.in')
 * @param {string} [socksProxy] - Optional proxy endpoint URL (e.g. socks5://127.0.0.1:9050)
 * @param {{username?: string, password?: string}} [auth] - Optional proxy auth
 * @param {{headless?: boolean, enableFallback?: boolean, recordVideo?: boolean}} [options] - Options
 */
export async function runOrganicTorSearchSession(
  keyword = 'just paste it',
  targetDomain = 'justpasteit.in',
  socksProxy = null,
  auth = null,
  options = { headless: false, enableFallback: false, recordVideo: true }
) {
  const videosDir = path.resolve(__dirname, 'videos');
  if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
  }

  const busterExtensionPath = path.resolve(__dirname, 'extensions/buster');
  const hasBuster = fs.existsSync(busterExtensionPath);
  const userDataDir = path.resolve(__dirname, `temp_user_data_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  console.log(`\n===================================================`);
  console.log(`🛡️ Patchright Undetected Organic Google Search Session`);
  console.log(`🔑 Keyword: "${keyword}"`);
  console.log(`🎯 Target Domain: "${targetDomain}"`);
  console.log(`🌐 Proxy: ${socksProxy || 'Direct / Active SoftEther VPN'}`);
  console.log(`🧩 Buster Extension: ${hasBuster ? 'Loaded ✅' : 'Disabled'}`);
  console.log(`===================================================`);

  const storageState = getStorageStatePath();

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1366,768'
  ];

  if (hasBuster) {
    console.log(`🧩 Loading Buster extension into browser context: ${busterExtensionPath}`);
    launchArgs.push(
      `--disable-extensions-except=${busterExtensionPath}`,
      `--load-extension=${busterExtensionPath}`
    );
  }

  const contextOptions = {
    headless: false, // Required for extension content scripts to run
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    },
    args: launchArgs,
    ...(storageState ? { storageState } : {})
  };

  if (socksProxy) {
    contextOptions.proxy = {
      server: socksProxy,
      username: auth?.username,
      password: auth?.password
    };
  }

  if (options.recordVideo !== false) {
    contextOptions.recordVideo = {
      dir: videosDir,
      size: { width: 1366, height: 768 }
    };
  }

  const context = await chromium.launchPersistentContext(userDataDir, contextOptions);
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Track Google Analytics events
  let gaEventsCount = 0;
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('google-analytics.com') || u.includes('analytics.google.com') || u.includes('/g/collect')) {
      gaEventsCount++;
      console.log(`📊 [GA Event Dispatched] -> ${u.substring(0, 85)}...`);
    }
  });

  try {
    // Step 1: Check Outgoing IP & Geo
    console.log(`🌐 Checking outgoing IP via api.ipify.org...`);
    try {
      await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 10000 });
      const ipContent = await page.textContent('body');
      console.log(`✅ Active Outgoing IP: ${ipContent.trim()}`);
    } catch (e) {
      console.warn(`⚠️ IP check notice: ${e.message}`);
    }

    // Step 2: Navigate to Google Search
    console.log(`🌐 Navigating to Google Search (https://www.google.com)...`);
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await handlePopupsAndVerification(page);

    // Step 3: Type Search Keyword
    console.log(`⌨️ Typing search query: "${keyword}"...`);
    const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
    await searchBox.waitFor({ state: 'visible', timeout: 15000 });
    await searchBox.click();
    await searchBox.pressSequentially(keyword, { delay: 75 + Math.floor(Math.random() * 40) });
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');

    console.log(`⏳ Waiting for Google Search results...`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await handlePopupsAndVerification(page);

    // Step 4: Scan and Find Target Domain
    console.log(`🔍 Scanning search results for target domain: "${targetDomain}"...`);
    
    // Find matching link with locator
    const allLinks = await page.locator('a[href]').all();
    let targetLinkLocator = null;

    for (const link of allLinks) {
      const href = await link.getAttribute('href').catch(() => null);
      if (href) {
        try {
          const parsed = new URL(href, 'https://www.google.com');
          if (parsed.hostname === targetDomain || parsed.hostname === 'www.' + targetDomain || href.includes(targetDomain)) {
            targetLinkLocator = link;
            break;
          }
        } catch (e) {}
      }
    }

    if (targetLinkLocator) {
      console.log(`🎯 Found matching search result for "${targetDomain}"! Scrolling and clicking...`);
      await targetLinkLocator.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1000 + Math.random() * 1000);
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {}),
        targetLinkLocator.click()
      ]);

      console.log(`📍 Landed on: "${await page.title().catch(() => 'Title')}" (${page.url()})`);
      await handlePopupsAndVerification(page);

      // Verify we reached target domain
      if (!page.url().includes(targetDomain)) {
        console.warn(`⚠️ Not on target domain yet (${page.url()}). Navigating directly to target...`);
        await page.goto(`https://${targetDomain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }

      console.log(`✅ Arrived at Target Page: "${await page.title().catch(() => 'Title')}" (${page.url()})`);

      // Step 5: Simulate Engaged User Behavior (Dwell & Scroll)
      console.log(`⏱️ Simulating engaged visitor session on target site for GA tracking...`);
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 200 + Math.floor(Math.random() * 150));
        await page.waitForTimeout(2000 + Math.floor(Math.random() * 1000));
      }

      console.log(`📈 Organic Search GA Summary: Dispatched ${gaEventsCount} GA tracking events!`);
    } else {
      console.warn(`⚠️ Target domain "${targetDomain}" not found in top Google SERP. Navigating directly...`);
      await page.goto(`https://${targetDomain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }

    console.log(`✨ Patchright Organic Search Session completed successfully!`);

  } catch (error) {
    console.error(`❌ Error during organic search session:`, error.message);
  } finally {
    // Closing the context flushes the recorded video file
    await context.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}

    // Identify and log recorded video
    const video = page.video();
    if (video) {
      const savedPath = await video.path().catch(() => null);
      if (savedPath) {
        console.log(`🎬 Saved Video Recording: ${savedPath}`);
      }
    }
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
  let enableFallback = false;
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
