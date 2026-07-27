import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

const SOCKS5_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=3000&country=all',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt'
];

function checkTorProxy() {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 9050,
      method: 'CONNECT',
      path: 'api.ipify.org:80',
      timeout: 2500
    });

    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(true);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function fetchText(urlStr) {
  return new Promise((resolve) => {
    https.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

function testProxy(proxyUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl);
      const req = http.request({
        host: url.hostname,
        port: url.port,
        method: 'CONNECT',
        path: 'httpbin.org:80',
        timeout: 3000
      });

      req.on('connect', (res, socket) => {
        socket.destroy();
        resolve({ proxy: proxyUrl, working: true });
      });

      req.on('error', () => resolve({ proxy: proxyUrl, working: false }));
      req.on('timeout', () => { req.destroy(); resolve({ proxy: proxyUrl, working: false }); });
      req.end();
    } catch (e) {
      resolve({ proxy: proxyUrl, working: false });
    }
  });
}

async function main() {
  console.log('🔄 Option 2: Dynamically Aggregating Free SOCKS5 & Public Proxy APIs...');
  const workingProxies = [];

  // 1. Check TOR Local Proxy first
  const isTorActive = await checkTorProxy();
  if (isTorActive) {
    console.log('🧅 Local TOR SOCKS5 proxy active (socks5://127.0.0.1:9050)');
    workingProxies.push('socks5://127.0.0.1:9050');
  }

  // 2. Aggregate candidate SOCKS5 list from APIs
  const candidateSet = new Set();
  for (const src of SOCKS5_SOURCES) {
    const text = await fetchText(src);
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(trimmed)) {
        candidateSet.add(`socks5://${trimmed}`);
      }
    }
  }

  const candidates = Array.from(candidateSet);
  console.log(`Fetched ${candidates.length} SOCKS5 candidates across APIs. Testing responsiveness in parallel...`);

  // Test top 60 candidates in parallel batches of 15
  const sample = candidates.slice(0, 60);
  for (let i = 0; i < sample.length; i += 15) {
    const batch = sample.slice(i, i + 15);
    const results = await Promise.all(batch.map(p => testProxy(p)));
    for (const r of results) {
      if (r.working && !workingProxies.includes(r.proxy)) {
        console.log(`  ✅ Active SOCKS5 Proxy: ${r.proxy}`);
        workingProxies.push(r.proxy);
      }
    }
  }

  console.log(`\nVerified ${workingProxies.length} active proxies for config.json.`);

  // Update config.json
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {}
  }

  config.proxies = workingProxies;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log(`✅ Updated config.json with ${workingProxies.length} proxies.`);
}

main().catch(err => {
  console.error('Option 2 Proxy aggregation failed:', err.message);
  process.exit(0);
});
