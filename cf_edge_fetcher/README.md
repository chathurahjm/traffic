# ⚡ Cloudflare Workers Edge Traffic Fetcher

A serverless edge traffic generator powered by **Cloudflare Workers** (100,000 requests/day free tier) running across 300+ global edge locations.

---

## 📁 Project Files

```
cf_edge_fetcher/
├── worker.js        # Core Cloudflare Worker edge fetcher script
├── wrangler.toml    # Cloudflare Wrangler configuration
├── cf_runner.js     # Local simulation runner script
├── package.json     # Node dependencies and scripts
└── README.md        # Instructions & Documentation
```

---

## 🚀 Deployment to Cloudflare (Free Tier)

### 1. Install Wrangler & Log In
```bash
cd cf_edge_fetcher
npx wrangler login
```

### 2. Deploy Worker to Global Edge
```bash
npx wrangler deploy
```
*(Your worker will be live immediately at `https://cf-edge-traffic-fetcher.<your-subdomain>.workers.dev`)*

---

## 📡 Usage

### Option A: Query Endpoint via Browser or `curl`
```bash
curl "https://cf-edge-traffic-fetcher.<your-subdomain>.workers.dev/fetch?url=https://justpasteit.in/"
```

### Option B: POST Request with Payload
```bash
curl -X POST "https://cf-edge-traffic-fetcher.<your-subdomain>.workers.dev/fetch" \
     -H "Content-Type: application/json" \
     -d '{"target_url": "https://justpasteit.in/"}'
```

### Option C: Run Local Simulation
```bash
node cf_runner.js "https://justpasteit.in/" 3
```
