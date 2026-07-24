import puppeteer from 'puppeteer-core';

async function testProxyRouting() {
  // Let's read the configuration or use a test proxy if configured
  console.log('=== Testing Proxy Routing and Location Detection ===\n');

  // Load configuration from local status endpoint
  let config = {};
  try {
    const res = await fetch('http://localhost:3000/api/status');
    const data = await res.json();
    config = data.config;
    console.log('Current Configured Proxies:', config.proxies);
  } catch (e) {
    console.log('Could not fetch server configuration. Testing with direct connection.');
  }

  const proxies = config.proxies || [];
  if (proxies.length === 0) {
    console.log('\nWARNING: No proxies are currently configured in the dashboard. The simulator is running with your direct local connection, which reports your local region.');
    console.log('Please add proxy IPs (e.g., http://username:password@ip:port or http://ip:port) in the dashboard.');
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

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...proxyArgs]
  });

  try {
    const page = await browser.newPage();
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    console.log('Fetching IP location info via proxy...');
    await page.goto('https://ipapi.co/json/', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    const ipInfo = JSON.parse(bodyText);
    
    console.log('\n=== Detected IP Info ===');
    console.log(`IP Address: ${ipInfo.ip}`);
    console.log(`City:       ${ipInfo.city}`);
    console.log(`Region:     ${ipInfo.region}`);
    console.log(`Country:    ${ipInfo.country_name} (${ipInfo.country_code})`);
    console.log(`Org/ISP:    ${ipInfo.org}`);
    
  } catch (error) {
    console.error('\nProxy Connection Failed:', error.message);
    console.log('Check if the proxy is online, active, or if it requires different credentials.');
  } finally {
    await browser.close();
  }
}

testProxyRouting();
