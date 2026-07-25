import puppeteer from 'puppeteer-core';

async function testProxyRouting() {
  // Let's read the configuration or use a test proxy if configured
  console.log('=== Testing Proxy Routing and Location Detection ===\n');

  // Read config.json file directly
  let config = {};
  try {
    const fs = await import('fs');
    const fileData = fs.readFileSync('config.json', 'utf8');
    config = JSON.parse(fileData);
  } catch (e) {
    console.log('Could not read config.json:', e.message);
  }

  console.log('Current Configured Proxies:', config.proxies || []);

  const proxies = config.proxies || [];
  if (proxies.length === 0) {
    console.log('\nWARNING: No proxies are currently configured in config.json.');
    return;
  }

  // Pick the first proxy to test
  const testProxy = proxies[0].trim();
  console.log(`\nTesting Proxy: ${testProxy}`);

  let proxyArgs = [];
  let proxyAuth = null;
  try {
    let urlStr = testProxy;
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://') && !urlStr.startsWith('socks5://')) {
      urlStr = 'http://' + urlStr;
    }
    const url = new URL(urlStr);
    // Puppeteer proxy-server format should be: protocol://host:port or simply host:port
    proxyArgs.push(`--proxy-server=${url.protocol}//${url.host}`);
    if (url.username && url.password) {
      proxyAuth = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    }
  } catch (e) {
    console.log('Invalid proxy format:', testProxy);
    return;
  }

  const fs = await import('fs');
  const chromePath = process.env.CHROME_BIN || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser'
  ].find(p => fs.existsSync(p)) || '/usr/bin/google-chrome';

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...proxyArgs]
  });

  try {
    const page = await browser.newPage();
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    console.log('Fetching IP location info via proxy...');
    await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    const ipInfo = JSON.parse(bodyText);
    
    console.log('\n=== Detected IP Info via Webshare Proxy ===');
    console.log(`✅ Outbound Proxy IP Address: ${ipInfo.ip}`);
    console.log('✅ Webshare Proxy Routing SUCCESSFUL!');
    
  } catch (error) {
    console.error('\nProxy Connection Failed:', error.message);
    console.log('Check if the proxy is online, active, or if it requires different credentials.');
  } finally {
    await browser.close();
  }
}

testProxyRouting();
