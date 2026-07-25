import express from 'express';
import puppeteer from 'puppeteer-core';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Default Simulator State
let config = {
  targetUrl: '',
  totalVisits: 100,
  concurrency: 3,
  minDwellTime: 10,
  maxDwellTime: 30,
  referrers: ['direct', 'google', 'facebook', 'twitter', 'linkedin'],
  headless: true,
  proxies: []
};

// Load persisted configuration if exists
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const fileData = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = { ...config, ...JSON.parse(fileData) };
    console.log('Loaded configuration from config.json');
  } catch (e) {
    console.error('Error loading config.json:', e.message);
  }
}

function saveConfigToFile() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving config.json:', e.message);
  }
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

let stats = {
  status: 'idle', // idle, running, paused, stopped
  visitsCompleted: 0,
  visitsFailed: 0,
  activeWorkers: 0,
  startTime: null,
  elapsedTime: 0
};

let activeWorkersList = [];
let logs = [];
let clients = [];

// Helper to broadcast SSE updates
function broadcast(event, data) {
  clients.forEach(client => {
    try {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  });
}

// Keep-alive heartbeat to prevent SSE connection timeouts
setInterval(() => {
  clients.forEach(client => {
    try {
      client.write(`: keep-alive\n\n`);
    } catch (e) {}
  });
}, 15000);

function addLog(message, type = 'info') {
  const log = {
    id: uuidv4(),
    timestamp: new Date().toLocaleTimeString(),
    message,
    type
  };
  logs.unshift(log);
  if (logs.length > 100) logs.pop();
  broadcast('log', log);
}

// User Agent pool
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1'
];

const referrerUrls = {
  direct: '',
  google: 'https://www.google.com/',
  facebook: 'https://www.facebook.com/',
  twitter: 'https://twitter.com/',
  linkedin: 'https://www.linkedin.com/'
};

// Simulation controller
let simulatorInterval = null;

async function runWorker() {
  stats.activeWorkers++;
  broadcast('stats', stats);

  let browser = null;
  const workerId = uuidv4().slice(0, 8);
  addLog(`[Worker ${workerId}] Initializing visit...`, 'info');

  try {
    const referrerType = config.referrers[Math.floor(Math.random() * config.referrers.length)];
    const referrer = referrerUrls[referrerType] || '';
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
          addLog(`[Worker ${workerId}] Using proxy: ${url.host}`, 'info');
        } catch (e) {
          addLog(`[Worker ${workerId}] Invalid proxy format: ${rawProxy}`, 'warning');
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
    if (config.targetUrl) {
      try {
        await context.overridePermissions(config.targetUrl, ['geolocation']);
      } catch (pErr) {}
    }
    const page = await context.newPage();

    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    // Set User Agent
    await page.setUserAgent(userAgent);

    // DevTools Geolocation & Timezone Emulation
    const locationProfiles = [
      { name: 'London, UK', timezone: 'Europe/London', lat: 51.5074, lng: -0.1278 },
      { name: 'Tokyo, Japan', timezone: 'Asia/Tokyo', lat: 35.6762, lng: 139.6503 },
      { name: 'New York, US', timezone: 'America/New_York', lat: 40.7128, lng: -74.0060 },
      { name: 'Sydney, Australia', timezone: 'Australia/Sydney', lat: -33.8688, lng: 151.2093 },
      { name: 'Paris, France', timezone: 'Europe/Paris', lat: 48.8566, lng: 2.3522 }
    ];
    const targetLoc = locationProfiles[Math.floor(Math.random() * locationProfiles.length)];
    try {
      await page.emulateTimezone(targetLoc.timezone);
      const cdpSession = await page.target().createCDPSession();
      await cdpSession.send('Emulation.setGeolocationOverride', {
        latitude: targetLoc.lat,
        longitude: targetLoc.lng,
        accuracy: 100
      });
      addLog(`[Worker ${workerId}] Emulating location/timezone: ${targetLoc.name} (${targetLoc.timezone})`, 'info');
    } catch (locErr) {
      addLog(`[Worker ${workerId}] Could not set location emulation: ${locErr.message}`, 'warning');
    }

    // Stealth Evasion Script to bypass Google Analytics & Cloudflare Bot Detection
    await page.evaluateOnNewDocument((ref) => {
      // 1. Override navigator.webdriver (CRITICAL: GA4 silently discards hits when webdriver === true)
      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      // 2. Mock plugins array
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefoxmcalj' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' }
        ]
      });

      // 3. Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // 4. Mock window.chrome
      window.chrome = { runtime: {} };

      // 5. Mock referrer if provided
      if (ref) {
        Object.defineProperty(document, 'referrer', {
          get: () => ref,
          configurable: true
        });
      }
    }, referrer);

    // Set realistic Desktop Viewport
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // Detect Google Analytics collection requests
    let gaHitDetected = false;
    page.on('request', req => {
      const reqUrl = req.url();
      if (reqUrl.includes('google-analytics.com') || reqUrl.includes('analytics.google.com') || reqUrl.includes('/g/collect')) {
        gaHitDetected = true;
        addLog(`[Worker ${workerId}] 🎯 GA Network Hit Detected: ${reqUrl.split('?')[0]}`, 'success');
      }
    });

    if (referrer) {
      addLog(`[Worker ${workerId}] Spoofing referrer: ${referrerType} (${referrer})`, 'info');
    } else {
      addLog(`[Worker ${workerId}] Direct visit (no referrer)`, 'info');
    }

    // Load Target URL (pick from targetUrls array or single targetUrl)
    const validUrls = (config.targetUrls && config.targetUrls.length > 0) 
      ? config.targetUrls.filter(u => u && u.trim()) 
      : [config.targetUrl];
    const chosenUrl = validUrls[Math.floor(Math.random() * validUrls.length)] || config.targetUrl;

    const gotoOptions = { waitUntil: 'networkidle2', timeout: 45000 };
    if (referrer) {
      gotoOptions.referrer = referrer;
    }

    addLog(`[Worker ${workerId}] Navigating to ${chosenUrl}`, 'info');
    await page.goto(chosenUrl, gotoOptions);
    addLog(`[Worker ${workerId}] Page loaded successfully.`, 'success');

    // Simulate realistic mouse movements
    try {
      await page.mouse.move(200, 300);
      await page.mouse.move(500, 400);
      await page.mouse.move(300, 600);
    } catch (mErr) {}

    // Handle Cookie Consent Banner if present
    addLog(`[Worker ${workerId}] Checking for cookie consent banner...`, 'info');
    const clickedConsent = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const acceptButton = buttons.find(btn => {
        const text = btn.innerText.trim().toLowerCase();
        return text === 'accept all' || text === 'accept' || text === 'agree' || text.includes('accept cookies');
      });

      if (acceptButton) {
        acceptButton.click();
        return true;
      }
      return false;
    });

    if (clickedConsent) {
      addLog(`[Worker ${workerId}] Cookie consent accepted ("Accept All" clicked).`, 'success');
      // Wait a moment for GA scripts to load and trigger after consent
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      addLog(`[Worker ${workerId}] No cookie consent banner detected or auto-accepted.`, 'info');
    }

    // Emulate human behavior: Scroll Down
    addLog(`[Worker ${workerId}] Simulating human scrolling...`, 'info');
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });

    // Stay on page for dwell time
    const dwellTime = Math.floor(Math.random() * (config.maxDwellTime - config.minDwellTime + 1)) + config.minDwellTime;
    addLog(`[Worker ${workerId}] Dwelling on page for ${dwellTime}s...`, 'info');
    await new Promise(resolve => setTimeout(resolve, (dwellTime / 2) * 1000));

    // Try to trigger secondary navigation (internal link click) to increase engagement rate in GA4
    addLog(`[Worker ${workerId}] Looking for an internal link to click...`, 'info');
    const clickedInternal = await page.evaluate(async () => {
      const links = Array.from(document.querySelectorAll('a'));
      const currentHost = window.location.host;
      const internalLinks = links.filter(link => {
        try {
          const url = new URL(link.href);
          return url.host === currentHost && url.pathname !== window.location.pathname && !url.hash;
        } catch (e) {
          return false;
        }
      });

      if (internalLinks.length > 0) {
        // Pick a random internal link and click it
        const randomLink = internalLinks[Math.floor(Math.random() * internalLinks.length)];
        randomLink.click();
        return true;
      }
      return false;
    });

    if (clickedInternal) {
      addLog(`[Worker ${workerId}] Navigated to internal link to boost session engagement.`, 'success');
      // Wait for secondary page load and dwell
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, (dwellTime / 2) * 1000));
    } else {
      addLog(`[Worker ${workerId}] No internal links found. Staying on home page.`, 'info');
      await new Promise(resolve => setTimeout(resolve, (dwellTime / 2) * 1000));
    }

    stats.visitsCompleted++;
    addLog(`[Worker ${workerId}] Session completed successfully.`, 'success');
  } catch (error) {
    stats.visitsFailed++;
    addLog(`[Worker ${workerId}] Session failed: ${error.message}`, 'error');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stats.activeWorkers--;
    broadcast('stats', stats);
  }
}

// Simulation Manager Loop
function startSimulationLoop() {
  if (simulatorInterval) return;

  stats.startTime = stats.startTime || Date.now();
  
  simulatorInterval = setInterval(async () => {
    if (stats.status !== 'running') return;

    // Check if target reached
    if (stats.visitsCompleted + stats.visitsFailed >= config.totalVisits) {
      addLog('Target visit count reached. Stopping simulator.', 'success');
      stopSimulation();
      return;
    }

    // Spawn workers up to concurrency limit
    if (stats.activeWorkers < config.concurrency) {
      const remaining = config.totalVisits - (stats.visitsCompleted + stats.visitsFailed);
      const spawnCount = Math.min(config.concurrency - stats.activeWorkers, remaining);
      for (let i = 0; i < spawnCount; i++) {
        runWorker();
      }
    }

    // Update elapsed time
    if (stats.startTime) {
      stats.elapsedTime = Math.floor((Date.now() - stats.startTime) / 1000);
      broadcast('stats', stats);
    }
  }, 2000);
}

function stopSimulation() {
  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
  }
  stats.status = 'idle';
  broadcast('stats', stats);
}

// REST API Endpoints
app.post('/api/config', (req, res) => {
  const { targetUrl, targetUrls, totalVisits, concurrency, minDwellTime, maxDwellTime, referrers, headless, proxies } = req.body;
  
  const parsedUrls = Array.isArray(targetUrls) 
    ? targetUrls.filter(u => u && u.trim()) 
    : (targetUrl ? [targetUrl] : (config.targetUrls || []));

  if (parsedUrls.length === 0 && !targetUrl) {
    return res.status(400).json({ error: 'At least one target URL is required' });
  }

  config = {
    ...config,
    targetUrl: targetUrl || parsedUrls[0] || '',
    targetUrls: parsedUrls,
    totalVisits: parseInt(totalVisits) || config.totalVisits || 100,
    concurrency: parseInt(concurrency) || config.concurrency || 3,
    minDwellTime: parseInt(minDwellTime) || config.minDwellTime || 10,
    maxDwellTime: parseInt(maxDwellTime) || config.maxDwellTime || 30,
    referrers: referrers || config.referrers,
    headless: headless !== undefined ? headless : config.headless,
    proxies: Array.isArray(proxies) ? proxies.filter(p => p && p.trim()) : config.proxies
  };

  addLog(`Configuration updated. Target URLs (${config.targetUrls.length}): ${config.targetUrls.join(', ')}`, 'info');
  saveConfigToFile();
  res.json({ success: true, config });
});

app.post('/api/start', (req, res) => {
  const hasTarget = config.targetUrl || (Array.isArray(config.targetUrls) && config.targetUrls.some(u => u && u.trim()));
  if (!hasTarget) {
    return res.status(400).json({ error: 'Simulator is not configured. Set configuration first.' });
  }
  
  if (stats.status === 'running') {
    return res.json({ message: 'Already running' });
  }

  // Reset counters if starting fresh from idle state
  if (stats.status === 'idle') {
    stats.visitsCompleted = 0;
    stats.visitsFailed = 0;
    stats.elapsedTime = 0;
    stats.startTime = Date.now();
  }

  stats.status = 'running';
  startSimulationLoop();
  addLog('Traffic simulation started.', 'info');
  res.json({ success: true, stats });
});

app.post('/api/pause', (req, res) => {
  if (stats.status !== 'running') {
    return res.json({ message: 'Not running' });
  }
  stats.status = 'paused';
  addLog('Traffic simulation paused.', 'info');
  res.json({ success: true, stats });
});

app.post('/api/stop', (req, res) => {
  stopSimulation();
  stats.startTime = null;
  stats.elapsedTime = 0;
  stats.visitsCompleted = 0;
  stats.visitsFailed = 0;
  addLog('Traffic simulation stopped and reset.', 'info');
  res.json({ success: true, stats });
});

app.get('/api/status', (req, res) => {
  res.json({ stats, config });
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.push(res);

  // Send current stats and last 20 logs immediately
  res.write(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`);
  res.write(`event: config\ndata: ${JSON.stringify(config)}\n\n`);
  
  logs.slice().reverse().forEach(log => {
    res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
  });

  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
