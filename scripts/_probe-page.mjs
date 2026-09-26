import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log("console:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("http://localhost:3100/invite?token=" + "a".repeat(72) + "&email=invitee%40example.test", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("--- visible text ---");
console.log(await page.locator("main").innerText());
console.log("--- password inputs:", await page.locator("input[type=password]").count());
await browser.close();
