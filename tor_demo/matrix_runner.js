import { runOrganicTorSearchSession } from './tor_google_search.js';

/**
 * Multi-session runner for GitHub Actions & OS Matrix environment
 * Usage:
 *   node matrix_runner.js <iterations> <keyword> <targetDomain> [--headless]
 * Example:
 *   node matrix_runner.js 7 "just paste it" "justpasteit.in" --headless
 */
async function main() {
  const args = process.argv.slice(2);
  const iterations = parseInt(args[0] || '7', 10);
  const keyword = args[1] && !args[1].startsWith('--') ? args[1] : 'just paste it';
  const targetDomain = args[2] && !args[2].startsWith('--') ? args[2] : 'justpasteit.in';
  const isHeadless = args.includes('--headless');

  console.log(`===================================================`);
  console.log(`🚀 Multi-OS Matrix Organic Google Search Runner`);
  console.log(`💻 Platform: ${process.platform} (${process.arch})`);
  console.log(`🖥️ Mode: ${isHeadless ? 'Headless' : 'Visible UI'}`);
  console.log(`🔄 Planned Sessions: ${iterations}`);
  console.log(`🔑 Keyword: "${keyword}"`);
  console.log(`🎯 Target Domain: "${targetDomain}"`);
  console.log(`===================================================`);

  let successfulSessions = 0;

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📌 Session ${i} of ${iterations}`);
    try {
      await runOrganicTorSearchSession(
        keyword,
        targetDomain,
        null, // Direct connection / System SoftEther VPN
        null,
        { headless: isHeadless, enableFallback: false, recordVideo: true }
      );
      successfulSessions++;
    } catch (err) {
      console.error(`⚠️ Session ${i} error:`, err.message);
    }

    if (i < iterations) {
      const delay = Math.floor(Math.random() * 4000) + 3000;
      console.log(`⏳ Pausing ${(delay / 1000).toFixed(1)}s before launching next organic session...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log(`\n===================================================`);
  console.log(`🎉 Completed ${successfulSessions}/${iterations} sessions on ${process.platform}!`);
  console.log(`===================================================`);
}

main().catch(console.error);
