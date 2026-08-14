import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE_PATH = path.join(__dirname, "auth_state.json");

(async () => {
    console.log("🚀 Launching interactive browser for one-time Google / YouTube login...");

    const possibleChromePaths = [
        process.env.CHROME_BIN,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ].filter(Boolean);

    const detectedChrome = possibleChromePaths.find(p => fs.existsSync(p));

    const launchOptions = {
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled"
        ]
    };

    if (detectedChrome) {
        launchOptions.executablePath = detectedChrome;
        console.log(`✅ Using system Chrome: ${detectedChrome}`);
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    console.log("🎥 Opening YouTube login page...");
    await page.goto("https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/");

    console.log("\n=======================================================");
    console.log("👉 Please complete your login in the opened browser window.");
    console.log("👉 Once you are logged in, press [ENTER] in this terminal to save your session.");
    console.log("=======================================================\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise((resolve) => {
        rl.question("Press [ENTER] after you finish logging in: ", () => {
            rl.close();
            resolve();
        });
    });

    console.log("\n💾 Saving authenticated storage state (cookies & session)...");
    await context.storageState({ path: AUTH_FILE_PATH });
    console.log(`🎉 Success! Saved session to: ${AUTH_FILE_PATH}`);

    await browser.close();
    process.exit(0);
})();
