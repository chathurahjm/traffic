import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Check if local TOR SOCKS5 proxy is active
function checkTorProxy() {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 9050,
      method: 'CONNECT',
      path: 'api.ipify.org:80',
      timeout: 3000
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

// Fetch HTML content from URL
function fetchPage(urlStr) {
  return new Promise((resolve) => {
    https.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

// Test proxy socket connectivity
function testProxy(proxyUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl);
      const req = http.request({
        host: url.hostname,
        port: url.port,
        method: 'CONNECT',
        path: 'httpbin.org:80',
        timeout: 3500
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
  const workingProxies = [];

  // 1. First check if TOR SOCKS5 Proxy is running locally (e.g. 127.0.0.1:9050)
  const isTorActive = await checkTorProxy();
  if (isTorActive) {
    console.log('🧅 Local TOR SOCKS5 proxy detected on 127.0.0.1:9050');
    workingProxies.push('socks5://127.0.0.1:9050');
  }

  // 2. Fetch extra fresh proxies from ProxyDB
  console.log('🔄 Fetching proxy list from ProxyDB...');
  const html = await fetchPage('https://proxydb.net/?protocol=http&protocol=https&country=');

  const candidates = [];
  const regex = /\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const ip = match[1];
    const port = match[2];
    candidates.push(`http://${ip}:${port}`);
  }

  const uniqueCandidates = [...new Set(candidates)];
  for (const proxy of uniqueCandidates) {
    const res = await testProxy(proxy);
    if (res.working) {
      console.log(`  ✅ Verified active proxy: ${proxy}`);
      workingProxies.push(proxy);
    }
  }

  console.log(`\nVerified ${workingProxies.length} total active proxies (including TOR).`);

  // Load existing config.json
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {}
  }

  config.proxies = workingProxies;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

  if (workingProxies.length > 0) {
    console.log(`✅ Configured ${workingProxies.length} proxies in config.json:`, workingProxies);
  } else {
    console.log('⚠️ No active proxies found. Falling back to direct connection (proxies: []).');
  }
}

main().catch(err => {
  console.error('Proxy setup failed:', err.message);
  process.exit(0);
});
