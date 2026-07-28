import { runTorSession } from './tor_test.js';

/**
 * Multi-session runner with Visible Chrome UI Mode (headless: false)
 * Usage:
 *   node tor_runner.js 3 "https://ustpasteit.in/"          (Opens visible Chrome UI window)
 *   node tor_runner.js 3 "https://ustpasteit.in/" --headless (Runs silently in background)
 */
async function main() {
  const args = process.argv.slice(2);
  const iterations = parseInt(args[0] || '3', 10);
  const targetUrl = args[1] && !args[1].startsWith('--') ? args[1] : 'https://ustpasteit.in/';
  const isHeadless = args.includes('--headless');

  console.log(`===================================================`);
  console.log(`🧅 Tor Network + Puppeteer Traffic Demo (Visual UI)`);
  console.log(`🖥️ Mode: ${isHeadless ? 'Headless (Background)' : 'UI Window (Visible Chrome)'}`);
  console.log(`🔄 Planned Sessions: ${iterations}`);
  console.log(`🎯 Target Website: ${targetUrl}`);
  console.log(`===================================================`);

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📌 Session ${i} of ${iterations}`);

    // Using random SOCKS credentials for Tor circuit isolation
    const randomUser = `user_${Math.random().toString(36).substring(7)}`;
    const randomPass = `pass_${Math.random().toString(36).substring(7)}`;
    const socksProxy = 'socks5://127.0.0.1:9050';

    await runTorSession(
      targetUrl,
      socksProxy,
      { username: randomUser, password: randomPass },
      { headless: isHeadless, enableFallback: true }
    );

    if (i < iterations) {
      const delay = Math.floor(Math.random() * 3000) + 2000;
      console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s before launching next session UI...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log(`\n===================================================`);
  console.log(`🎉 All ${iterations} visual traffic sessions completed!`);
  console.log(`===================================================`);
}

main().catch(console.error);
