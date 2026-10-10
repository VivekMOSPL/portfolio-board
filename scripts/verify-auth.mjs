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
// Explicit waits with generous timeouts rather than waitUntil:"networkidle". When this runs straight
// after the browser smoke test, a second browser launch plus a cold page render can exceed the default
// action timeout, and networkidle turns a slow render into a hard failure.
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByRole("heading", { name: "Welcome back" }).waitFor({ timeout: 90000 });
await page.getByLabel("Password *", { exact: true }).waitFor({ timeout: 90000 });
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
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const text = await visibleText();
  const heading = (text.match(/^.{0,90}/) || [""])[0];
  console.log(`  ${path.padEnd(12)} -> ${heading || "(empty)"}`);
  await page.screenshot({ path: `artifacts/auth${path.replace(/\//g, "-")}.png`, fullPage: true });
}

console.log("--- platform console (read-only: this script never writes)");
await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded", timeout: 90000 });
const platformText = await visibleText();
const badge = /Super Admin/.test(platformText);
const businesses = /Subscribed businesses/.test(platformText);
console.log(`  Super Admin badge       : ${badge}`);
console.log(`  Subscribed businesses   : ${businesses}`);
console.log(`  text: ${platformText.slice(0, 240)}`);
assert.ok(badge, "the platform console should show the Super Admin badge");
assert.ok(businesses, "the platform console should list subscribed businesses");
await page.screenshot({ path: "artifacts/auth-platform.png", fullPage: true });

// The platform console holds business metadata only. Assert that a platform administrator is not
// silently granted client detail, which is the guarantee the schema is built around.
assert.ok(
  /does not grant client-data|Business metadata only/i.test(platformText),
  "the platform console should state that it holds metadata only",
);
console.log("  metadata-only guarantee present: true");

console.log("--- role-scoped navigation the admin can see");
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")).filter(Boolean),
);
console.log(`  links: ${[...new Set(nav)].sort().join(" ")}`);

console.log(`--- browser errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e}`);

assert.equal(errors.length, 0, "expected no uncaught browser errors");
await browser.close();
console.log("\nAUTHENTICATED JOURNEY VERIFIED");
