import { runOrganicTorSearchSession } from './tor_google_search.js';

/**
 * Organic Google Search Traffic Runner via Tor SOCKS5
 * Usage:
 *   node tor_search_runner.js 3 "just paste it" "justpasteit.in"           (Visual UI)
 *   node tor_search_runner.js 3 "just paste it" "justpasteit.in" --headless (Background)
 */
async function main() {
  const args = process.argv.slice(2);
  const iterations = parseInt(args[0] || '3', 10);
  const keyword = args[1] && !args[1].startsWith('--') ? args[1] : 'just paste it';
  const targetDomain = args[2] && !args[2].startsWith('--') ? args[2] : 'justpasteit.in';
  const isHeadless = args.includes('--headless');

  console.log(`===================================================`);
  console.log(`🔍 Tor Organic Google Search Traffic Generator`);
  console.log(`🔑 Search Keyword: "${keyword}"`);
  console.log(`🎯 Target Domain: "${targetDomain}"`);
  console.log(`🖥️ Mode: ${isHeadless ? 'Headless (Background)' : 'UI Window (Visible Chrome)'}`);
  console.log(`🔄 Planned Sessions: ${iterations}`);
  console.log(`===================================================`);

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📌 Session ${i} of ${iterations}`);
    
    // Using random SOCKS credentials for Tor circuit isolation
    const randomUser = `user_${Math.random().toString(36).substring(7)}`;
    const randomPass = `pass_${Math.random().toString(36).substring(7)}`;
    const socksProxy = 'socks5://127.0.0.1:9050';

    await runOrganicTorSearchSession(
      keyword,
      targetDomain,
      socksProxy, 
      { username: randomUser, password: randomPass },
      { headless: isHeadless, recordVideo: true }
    );

    if (i < iterations) {
      const delay = Math.floor(Math.random() * 3000) + 2000;
      console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s before launching next session...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log(`\n===================================================`);
  console.log(`🎉 All ${iterations} Organic Google Search sessions completed!`);
  console.log(`===================================================`);
}

main().catch(console.error);
