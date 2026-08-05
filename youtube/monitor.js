const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
    const browser = await chromium.launch({
        headless: true
    });

    const page = await browser.newPage();

    const url = process.env.TARGET_URL;

    await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 120000
    });

    if (!fs.existsSync("screenshots")) {
        fs.mkdirSync("screenshots");
    }

    await page.screenshot({
        path: `screenshots/${process.platform}.png`,
        fullPage: true
    });

    await browser.close();
})();