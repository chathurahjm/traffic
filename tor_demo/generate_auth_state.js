import { chromium } from 'patchright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateAuthState() {
  const outputPath = path.resolve(__dirname, 'auth_state_2.json');

  console.log(`\n=============================================================`);
  console.log(`🔐 Google Account Login Session Generator`);
  console.log(`=============================================================`);
  console.log(`🚀 Launching browser window...`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-US'
  });

  const page = await context.newPage();
  console.log(`🌐 Opening Google Sign-in page...`);
  await page.goto('https://accounts.google.com/ServiceLogin?service=mail&continue=https://www.google.com/');

  console.log(`\n👉 INSTRUCTIONS:`);
  console.log(`1. In the opened browser window, sign in to your Google Account.`);
  console.log(`2. Complete 2FA/verification if prompted.`);
  console.log(`3. Once you see the Google search homepage or dashboard:`);
  console.log(`   PRESS [ENTER] in this terminal to save your session.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    rl.question('👉 Press [ENTER] here once you are logged in to save session... ', () => {
      rl.close();
      resolve();
    });
  });

  console.log(`\n💾 Capturing authenticated session cookies and storage...`);
  await context.storageState({ path: outputPath });
  await browser.close().catch(() => {});

  if (fs.existsSync(outputPath)) {
    const content = fs.readFileSync(outputPath, 'utf8');

    // Automatically copy to clipboard on macOS if available
    try {
      execSync(`pbcopy < "${outputPath}"`);
      console.log(`📋 [COPIED TO CLIPBOARD] The entire AUTH_STATE_JSON_2 is already copied to your clipboard!`);
    } catch (e) {
      // pbcopy fallback
    }

    console.log(`\n=============================================================`);
    console.log(`✅ SUCCESS! Generated: ${outputPath}`);
    console.log(`=============================================================`);
    console.log(`📌 NEXT STEPS:`);
    console.log(`1. Go to: https://github.com/chathurahjm/traffic/settings/secrets/actions`);
    console.log(`2. Click "New repository secret" (or edit AUTH_STATE_JSON_2).`);
    console.log(`3. Name: AUTH_STATE_JSON_2`);
    console.log(`4. Value: Paste (Cmd + V) the copied JSON.`);
    console.log(`5. Click "Add secret" / "Update secret".`);
    console.log(`=============================================================\n`);
  }
}

generateAuthState().catch(console.error);
