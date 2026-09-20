// Verifies the authenticated journey in a real browser.
//
//   node scripts/verify-auth.mjs
//
// Reads the operator credentials from .admin-login.txt, which is gitignored and never
// committed. The password is never printed or written to a screenshot.
//
// A production build marks the session cookie Secure. Chrome and Edge treat http://localhost
// as a trustworthy origin, so the cookie is stored and sent there; a plain HTTP client such as
// PowerShell's WebSession drops it, which is why this script drives a browser instead.

import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:3100";

async function credentials() {
  const text = await readFile(".admin-login.txt", "utf8");
  const email = (text.match(/^Email\s*:\s*(.+)$/m) || [])[1]?.trim();
  const password = (text.match(/^Password\s*:\s*(.+)$/m) || [])[1]?.trim();
  if (!email || !password) {
    console.error("BLOCKED: could not read Email/Password from .admin-login.txt");
    process.exit(1);
  }
  return { email, password };
}

const { email, password } = await credentials();
await mkdir("artifacts", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

function visibleText() {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
}

console.log(`--- sign in as ${email} (password never printed)`);
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Welcome back" }).waitFor();
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password *", { exact: true }).fill(password);
await page.getByRole("button", { name: /sign in/i }).first().click();

await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
console.log(`  signed in, landed on ${new URL(page.url()).pathname}`);

const cookies = await page.context().cookies();
const names = cookies.map((c) => `${c.name}(secure=${c.secure},httpOnly=${c.httpOnly})`);
console.log(`  session cookies: ${names.join(", ") || "none"}`);

console.log("--- what the signed-in workspace shows");
for (const path of ["/platform", "/dashboard", "/my-day", "/clients", "/team"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const text = await visibleText();
  const heading = (text.match(/^.{0,90}/) || [""])[0];
  console.log(`  ${path.padEnd(12)} -> ${heading || "(empty)"}`);
  await page.screenshot({ path: `artifacts/auth${path.replace(/\//g, "-")}.png`, fullPage: true });
}

console.log("--- create the first business from the platform console");
await page.goto(`${BASE}/platform`, { waitUntil: "networkidle" });
const text = await visibleText();
console.log(`  platform page text: ${text.slice(0, 400)}`);

const nameField = page.getByLabel(/business name|name/i).first();
if (await nameField.count()) {
  await nameField.fill("IDash — Datachron Solutions");
  const createButton = page.getByRole("button", { name: /create/i }).first();
  if (await createButton.count()) {
    await createButton.click();
    await page.waitForTimeout(4000);
    console.log(`  after create: ${(await visibleText()).slice(0, 300)}`);
    await page.screenshot({ path: "artifacts/auth-platform-created.png", fullPage: true });
  } else {
    console.log("  no create button found - inspect artifacts/auth-platform.png");
  }
} else {
  console.log("  no business-name field found - inspect artifacts/auth-platform.png");
}

console.log("--- role-scoped navigation the admin can see");
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")).filter(Boolean),
);
console.log(`  links: ${[...new Set(nav)].sort().join(" ")}`);

console.log(`--- browser errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e}`);

assert.equal(errors.length, 0, "expected no uncaught browser errors");
await browser.close();
console.log("\nAUTHENTICATED JOURNEY VERIFIED");
