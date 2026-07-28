import http from 'http';

/**
 * Local simulation runner for Cloudflare Workers Edge Fetcher
 * Simulates edge location fetching & traffic dispatch locally
 */
async function runLocalEdgeSimulation() {
  const targetUrl = process.argv[2] || 'https://justpasteit.in/';
  const sessions = parseInt(process.argv[3] || '3', 10);

  console.log(`===================================================`);
  console.log(`⚡ Cloudflare Workers Edge Fetcher Traffic Runner`);
  console.log(`🎯 Target URL: ${targetUrl}`);
  console.log(`🔄 Planned Sessions: ${sessions}`);
  console.log(`===================================================`);

  for (let i = 1; i <= sessions; i++) {
    console.log(`\n📌 Session ${i} of ${sessions}`);
    const startTime = Date.now();

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': randomUserAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://www.google.com/'
        }
      });

      const duration = Date.now() - startTime;
      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : 'No Title';

      console.log(`✅ Status: ${response.status} ${response.statusText} (${duration}ms)`);
      console.log(`📄 Title: "${pageTitle}"`);
      console.log(`📦 Response Payload: ${html.length} bytes`);
    } catch (err) {
      console.error(`❌ Fetch Error:`, err.message);
    }

    if (i < sessions) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\n===================================================`);
  console.log(`🎉 Edge fetcher session dispatch completed!`);
  console.log(`===================================================`);
}

runLocalEdgeSimulation().catch(console.error);
