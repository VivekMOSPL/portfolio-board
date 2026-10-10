// Proves the application runs with no internet: signs in through the browser using a local account
// and asserts that every request it makes stays on this machine.
//
//   npm run verify:offline
//
// The network assertion is the point of this script. It records every request the browser issues and
// fails if any host other than the app's own origin is contacted, so a hidden call to a hosted service
// — Supabase, a font CDN, a telemetry endpoint — cannot pass unnoticed.

import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:3100";
const EXPECTED_EMAIL = process.env.VERIFY_EMAIL || "admin.a@followthrough.test";

const text = await readFile(".local-auth.txt", "utf8");
const block = text.split(/\r?\n\r?\n/).find((b) => b.includes(EXPECTED_EMAIL));
const email = EXPECTED_EMAIL;
const password = block ? (block.match(/password:\s*(\S+)/) || [])[1] : undefined;
if (!password) {
  console.error(`BLOCKED: no local password found for ${EXPECTED_EMAIL} in .local-auth.txt`);
  console.error("  Run npm run auth:seed-local first.");
  process.exit(1);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  -> " + detail : ""}`);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// Every request the page makes, so an external host cannot slip through.
const hosts = new Set();
const external = [];
page.on("request", (request) => {
  try {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    hosts.add(url.host);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) external.push(request.url());
  } catch {
    /* ignore unparseable urls */
  }
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

console.log(`Offline verification against ${BASE}`);
console.log(`  signing in as ${email}`);
console.log("");

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByRole("heading", { name: "Welcome back" }).waitFor({ timeout: 90000 });
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password *", { exact: true }).fill(password);
await page.getByRole("button", { name: /sign in/i }).first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
check("signed in with a local account", true);

// The workspace must render real data, not the sign-in page.
for (const path of ["/dashboard", "/clients", "/team"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
  const rendered = body.includes("IDash") || body.includes("Follow-through");
  const notSignedOut = !/Welcome back/.test(body);
  check(`${path} renders the workspace`, rendered && notSignedOut, body.slice(0, 90));
}

// The scoped read must return rows for this account, through the API.
const clients = await page.evaluate(async () => {
  const r = await fetch("/api/data?resource=clients&tenant=10000000-0000-4000-8000-00000000000a");
  return { status: r.status, body: await r.json().catch(() => null) };
});
check("clients read succeeds for the admin", clients.status === 200, JSON.stringify(clients).slice(0, 120));
check("clients read returns the tenant's rows", Array.isArray(clients.body?.rows) && clients.body.rows.length === 3, `rows ${clients.body?.rows?.length}`);

// A tenant this account does not belong to must yield nothing, even though it is a valid uuid.
const cross = await page.evaluate(async () => {
  const r = await fetch("/api/data?resource=clients&tenant=10000000-0000-4000-8000-00000000000b");
  return { status: r.status, body: await r.json().catch(() => null) };
});
check("a foreign tenant yields no rows", (cross.body?.rows?.length ?? 0) === 0, JSON.stringify(cross).slice(0, 120));

console.log("");
console.log(`  hosts contacted: ${[...hosts].sort().join(", ")}`);
check("no request left this machine", external.length === 0, external.slice(0, 3).join(", "));
check("no uncaught browser errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "artifacts/offline-workspace.png", fullPage: true });
await browser.close();

console.log("");
if (failures) {
  console.log(`OFFLINE VERIFICATION FAILED: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("OFFLINE VERIFIED: the app signed in, served scoped data, and contacted nothing outside this machine.");
