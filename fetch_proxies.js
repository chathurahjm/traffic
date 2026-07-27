import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

const SOCKS5_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=1500&country=all',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt'
];

function checkTorProxy() {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({
      host: '127.0.0.1',
      port: 9050,
      method: 'CONNECT',
      path: '1.1.1.1:80',
      timeout: 1000
    });

    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve({ working: true, latency: Date.now() - start });
    });

    req.on('error', () => resolve({ working: false, latency: Infinity }));
    req.on('timeout', () => { req.destroy(); resolve({ working: false, latency: Infinity }); });
    req.end();
  });
}

function fetchText(urlStr) {
  return new Promise((resolve) => {
    https.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

// Optimized proxy tester: strict 800ms threshold + latency measurement
function testProxy(proxyUrl, timeoutMs = 800) {
  return new Promise((resolve) => {
    const start = Date.now();
    try {
      const url = new URL(proxyUrl);
      const req = http.request({
        host: url.hostname,
        port: url.port,
        method: 'CONNECT',
        path: '1.1.1.1:80',
        timeout: timeoutMs
      });

      req.on('connect', (res, socket) => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ proxy: proxyUrl, working: true, latency });
      });

      req.on('error', () => resolve({ proxy: proxyUrl, working: false, latency: Infinity }));
      req.on('timeout', () => { req.destroy(); resolve({ proxy: proxyUrl, working: false, latency: Infinity }); });
      req.end();
    } catch (e) {
      resolve({ proxy: proxyUrl, working: false, latency: Infinity });
    }
  });
}

async function main() {
  console.log('⚡ Running Optimized Free Public Proxy Filter (High-Concurrency Parallel Scan)...');
  const workingProxies = [];

  // Read current config to preserve any custom authenticated proxies
  let existingConfig = {};
  let customProxies = [];
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (Array.isArray(existingConfig.proxies)) {
        customProxies = existingConfig.proxies.filter(p => p && p.includes('@')); // user:pass authenticated proxies
      }
    } catch (e) {}
  }

  if (customProxies.length > 0) {
    console.log(`🔑 Preserved ${customProxies.length} authenticated proxy credentials.`);
    workingProxies.push(...customProxies);
  }

  // 1. Check local TOR proxy first
  const torStatus = await checkTorProxy();
  if (torStatus.working) {
    console.log(`🧅 Local TOR SOCKS5 proxy active (${torStatus.latency}ms latency)`);
    workingProxies.push('socks5://127.0.0.1:9050');
  }

  // 2. Fetch candidate public SOCKS5 lists in parallel
  console.log('📡 Fetching fresh public proxy sources...');
  const sourceResults = await Promise.all(SOCKS5_SOURCES.map(fetchText));
  
  const candidateSet = new Set();
  for (const text of sourceResults) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(trimmed)) {
        candidateSet.add(`socks5://${trimmed}`);
      }
    }
  }

  const candidates = Array.from(candidateSet);
  console.log(`🔍 Fetched ${candidates.length} total candidates. Testing top 100 in parallel (strict 800ms cap)...`);

  // 3. Test top 100 candidate proxies in 2 parallel waves of 50
  const sample = candidates.slice(0, 100);
  const startTime = Date.now();
  const testResults = await Promise.all(sample.map(p => testProxy(p, 800)));
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  // 4. Filter & sort by latency (fastest first)
  const validFastProxies = testResults
    .filter(r => r.working)
    .sort((a, b) => a.latency - b.latency);

  console.log(`⏱️ Parallel scan completed in ${scanDuration}s. Found ${validFastProxies.length} responsive proxies under 800ms.`);

  for (const item of validFastProxies) {
    if (!workingProxies.includes(item.proxy)) {
      console.log(`  ✅ [${item.latency}ms] Active Proxy: ${item.proxy}`);
      workingProxies.push(item.proxy);
    }
  }

  // Limit to top 15 fastest proxies
  const finalProxies = workingProxies.slice(0, 15);
  console.log(`\n💾 Saved top ${finalProxies.length} active proxies to config.json.`);

  // Update config.json
  existingConfig.proxies = finalProxies;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2), 'utf8');
}

main().catch(err => {
  console.error('❌ Optimized Proxy Aggregation failed:', err.message);
  process.exit(0);
});
