import { chromium } from "playwright";
import fs from "fs";

(async () => {
    const browser = await chromium.launch({
        headless: true
    });

    const page = await browser.newPage();

    const url = "https://www.youtube.com/watch?v=wvqdwiYKXSY&list=PLaW-yAT1_JFV5GyJX6fsuhbXTNLKVTeqS&index=1";

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