/**
 * Cloudflare Edge Worker Traffic Dispatcher Script
 * Triggers your deployed Cloudflare Edge Worker (100k requests/day free tier)
 * to perform serverless edge fetches from Cloudflare's global edge network.
 */
async function dispatchCloudflareEdgeTraffic() {
  const workerEndpoint = process.env.CF_WORKER_URL || 'https://cf-edge-traffic-fetcher.loadcja.workers.dev/fetch';
  const targetUrl = process.argv[2] || 'http://justpasteit.in/';
  const sessions = parseInt(process.argv[3] || '3', 10);

  console.log(`===================================================`);
  console.log(`⚡ Cloudflare Edge Worker Traffic Dispatcher`);
  console.log(`📡 Deployed Worker: ${workerEndpoint}`);
  console.log(`🎯 Target Site: ${targetUrl}`);
  console.log(`🔄 Sessions Goal: ${sessions}`);
  console.log(`===================================================`);

  for (let i = 1; i <= sessions; i++) {
    console.log(`\n📌 Session ${i} of ${sessions}`);

    try {
      const response = await fetch(workerEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_url: targetUrl })
      });

      if (!response.ok) {
        throw new Error(`Worker returned HTTP ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`✅ Success! Edge Datacenter: ${result.edge_location.datacenter} (${result.edge_location.city}, ${result.edge_location.country})`);
      console.log(`📊 Page Load Status: ${result.status} ${result.status_text} (${result.duration_ms}ms)`);
      console.log(`📄 Page Title: "${result.page_title_preview}"`);
      console.log(`📦 Bytes Received: ${result.response_bytes} bytes`);

    } catch (err) {
      console.error(`❌ Dispatch Error:`, err.message);
    }

    if (i < sessions) {
      const delay = Math.floor(Math.random() * 2000) + 1000;
      console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s before next edge dispatch...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`\n===================================================`);
  console.log(`🎉 All ${sessions} Cloudflare Edge traffic sessions completed!`);
  console.log(`===================================================`);
}

dispatchCloudflareEdgeTraffic().catch(console.error);
