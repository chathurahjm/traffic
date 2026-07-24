import puppeteer from 'puppeteer-core';

async function testEmulation() {
  console.log('Testing DevTools Geolocation & Timezone Emulation...');
  
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://example.com', ['geolocation']);

  const page = await context.newPage();
  const testProfile = { name: 'Tokyo, Japan', timezone: 'Asia/Tokyo', lat: 35.6762, lng: 139.6503 };

  await page.emulateTimezone(testProfile.timezone);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setGeolocationOverride', {
    latitude: testProfile.lat,
    longitude: testProfile.lng,
    accuracy: 100
  });

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

  const results = await page.evaluate(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        err => resolve({ error: err.message }),
        { timeout: 5000 }
      );
    });
    return { timezone: tz, ...pos };
  });

  console.log('Detected Timezone:', results.timezone);
  console.log('Detected Coordinates:', `${results.lat}, ${results.lng}`);

  await browser.close();

  if (results.timezone === testProfile.timezone && results.lat === testProfile.lat) {
    console.log('SUCCESS: DevTools Geolocation and Timezone emulation working!');
  } else {
    console.log('FAILED: Emulation result:', results);
  }
}

testEmulation().catch(err => {
  console.error('Error during test:', err.message);
});
