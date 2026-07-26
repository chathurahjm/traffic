import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

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

      req.on('error', (err) => {
        resolve({ proxy: proxyUrl, working: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ proxy: proxyUrl, working: false });
      });

      req.end();
    } catch (e) {
      resolve({ proxy: proxyUrl, working: false });
    }
  });
}

async function main() {
  console.log('🔄 Fetching fresh proxy list from ProxyDB...');
  const html = await fetchPage('https://proxydb.net/?protocol=http&protocol=https&country=');

  // Extract IP:Port patterns from HTML table
  const candidates = [];
  const regex = /\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const ip = match[1];
    const port = match[2];
    candidates.push(`http://${ip}:${port}`);
  }

  const uniqueCandidates = [...new Set(candidates)];
  console.log(`Found ${uniqueCandidates.length} candidate proxies. Testing connectivity...`);

  const workingProxies = [];
  for (const proxy of uniqueCandidates) {
    const res = await testProxy(proxy);
    if (res.working) {
      console.log(`  ✅ Working proxy: ${proxy}`);
      workingProxies.push(proxy);
    }
  }

  console.log(`\nVerified ${workingProxies.length} active proxies.`);

  // Load existing config.json
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {}
  }

  // Update proxies list in config.json
  config.proxies = workingProxies;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

  if (workingProxies.length > 0) {
    console.log(`✅ Dynamically configured ${workingProxies.length} active proxies in config.json.`);
  } else {
    console.log('⚠️ No active public proxies found. Falling back to direct connection (proxies: []).');
  }
}

main().catch(err => {
  console.error('Proxy fetch failed:', err.message);
  process.exit(0); // Exit cleanly to prevent blocking workflow
});
