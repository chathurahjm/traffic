# 🧅 Tor Network SOCKS5 + Puppeteer Traffic Demo

This sample project demonstrates how to route **Puppeteer browser traffic through the Tor Network SOCKS5 proxy** (`socks5://127.0.0.1:9050`) to generate website visits across dynamically rotated global exit IP addresses.

---

## 📁 Project Structure

```
tor_demo/
├── package.json               # Node.js configuration & dependencies
├── tor_test.js                # Single session Puppeteer Tor execution script
├── tor_runner.js              # Multi-session runner with automatic circuit/IP isolation
├── github_action_example.yml  # GitHub Actions workflow template
└── README.md                  # Instructions and documentation
```

---

## 🚀 Quick Setup & Usage

### Step 1: Install & Start Tor Daemon

#### On macOS (using Homebrew):
```bash
brew install tor
brew services start tor
```
*(Verify Tor is listening on port 9050: `curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip`)*

#### On Ubuntu / Debian:
```bash
sudo apt-get update
sudo apt-get install -y tor
sudo service tor start
```

---

### Step 2: Install Node Dependencies

```bash
cd tor_demo
npm install
```

---

### Step 3: Run the Tor Traffic Demo

#### Run a Single Test Session:
```bash
node tor_test.js "https://ustpasteit.in/"
```

#### Run Multi-Session IP Rotation Demo:
```bash
# Syntax: node tor_runner.js <number_of_sessions> <target_url>
node tor_runner.js 3 "https://ustpasteit.in/"
```

---

## 💡 How Tor IP Isolation Works in Puppeteer

1. **SOCKS5 Proxy Argument**:
   Puppeteer is launched with `--proxy-server=socks5://127.0.0.1:9050`.
2. **Circuit Isolation via Credentials**:
   Tor SOCKS proxy automatically assigns a new circuit (and thus a new exit IP address) when different SOCKS username/password credentials are passed in the proxy URI:
   ```javascript
   const proxy = `socks5://${randomUser}:${randomPass}@127.0.0.1:9050`;
   ```
3. **Verification**:
   The script queries `https://check.torproject.org/api/ip` at the start of each session to print the exact Tor Exit IP address and confirm Tor routing.

---

## 🤖 Running in GitHub Actions

You can copy `github_action_example.yml` to your `.github/workflows/tor_traffic.yml` directory to run this on a scheduled or manual trigger inside GitHub Actions!
