/**
 * Cloudflare Worker: Edge Fetcher & Traffic Generator
 * Executes at Cloudflare's 300+ global edge locations.
 * Returns response metadata including Cloudflare Data Center location (colo), outgoing IP, status, and duration.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint 1: Healthcheck & Info
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'Cloudflare Edge Traffic Fetcher',
        colo: request.cf?.colo || 'UNKNOWN',
        country: request.cf?.country || 'UNKNOWN',
        city: request.cf?.city || 'UNKNOWN',
        clientIp: request.headers.get('cf-connecting-ip') || 'UNKNOWN',
        usage: 'GET /fetch?url=https://justpasteit.in/ or POST /fetch with JSON body { "target_url": "..." }'
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Endpoint 2: Execute Edge Fetch Traffic Simulation
    if (url.pathname === '/fetch') {
      let targetUrl = url.searchParams.get('url') || 'https://justpasteit.in/';
      
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (body.target_url) targetUrl = body.target_url;
        } catch (e) {
          // Ignore JSON parse error and fallback to query param or default
        }
      }

      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      ];
      const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

      const startTime = Date.now();
      try {
        const fetchResponse = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': randomUserAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.google.com/'
          },
          redirect: 'follow'
        });

        const duration = Date.now() - startTime;
        const htmlContent = await fetchResponse.text();

        return new Response(JSON.stringify({
          success: true,
          target_url: targetUrl,
          status: fetchResponse.status,
          status_text: fetchResponse.statusText,
          duration_ms: duration,
          edge_location: {
            datacenter: request.cf?.colo || 'UNKNOWN',
            country: request.cf?.country || 'UNKNOWN',
            city: request.cf?.city || 'UNKNOWN',
            region: request.cf?.region || 'UNKNOWN'
          },
          response_bytes: htmlContent.length,
          page_title_preview: extractTitle(htmlContent)
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          target_url: targetUrl,
          error: err.message,
          edge_location: {
            datacenter: request.cf?.colo || 'UNKNOWN',
            country: request.cf?.country || 'UNKNOWN'
          }
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : 'No Title Found';
}
