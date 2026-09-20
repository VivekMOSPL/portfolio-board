// Verifies the SMTP settings in .env.local: connects, negotiates STARTTLS, authenticates,
// and optionally sends one test message.
//
//   node --env-file=.env.local scripts/verify-smtp.mjs            check credentials only
//   node --env-file=.env.local scripts/verify-smtp.mjs --send     also send a test message
//
// Reads everything from the environment. No credential is ever printed, and the password
// is not echoed even on failure.

import nodemailer from "nodemailer";

const SEND = process.argv.includes("--send");
const need = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"];
const missing = need.filter((n) => !process.env[n] || process.env[n].includes("["));
if (missing.length) {
  console.error(`BLOCKED: missing SMTP configuration: ${missing.join(", ")}`);
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT);
const fromEmail = process.env.SMTP_FROM_EMAIL;
const fromName = process.env.SMTP_FROM_NAME || fromEmail;

console.log("SMTP verification");
console.log(`  host      : ${host}:${port}`);
console.log(`  user      : ${process.env.SMTP_USER}`);
console.log(`  from      : ${fromName} <${fromEmail}>`);
console.log(`  password  : set (${process.env.SMTP_PASSWORD.length} chars, not shown)`);
console.log("");

const transport = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  requireTLS: port === 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
});

try {
  await transport.verify();
  console.log("  connection + STARTTLS + authentication : OK");
} catch (error) {
  console.error("  connection + authentication : FAILED");
  console.error(`  ${String(error.message).split("\n")[0]}`);
  console.error("  Common causes: wrong key, sender not verified in the provider, or port blocked.");
  process.exit(1);
}

if (!SEND) {
  console.log("");
  console.log("Credentials are valid. Re-run with --send to deliver one test message.");
  process.exit(0);
}

const recipient = process.env.SMTP_TEST_TO || fromEmail;
console.log(`\n  sending one test message to ${recipient} ...`);
try {
  const info = await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: recipient,
    subject: "IDash follow-up board - SMTP test",
    text: [
      "This is a configuration test from the IDash client follow-up board.",
      "",
      "If you are reading this, the SMTP settings work and transactional email can be sent",
      "from this account. No client data was included.",
    ].join("\n"),
  });
  console.log(`  accepted by the server : OK`);
  console.log(`  messageId : ${info.messageId}`);
  console.log(`  accepted  : ${JSON.stringify(info.accepted)}`);
  console.log(`  rejected  : ${JSON.stringify(info.rejected)}`);
  console.log("");
  console.log("SMTP DELIVERY VERIFIED - the provider accepted the message.");
  console.log("Acceptance is not proof of inbox placement; confirm the message arrived.");
} catch (error) {
  console.error("  send : FAILED");
  console.error(`  ${String(error.message).split("\n")[0]}`);
  process.exit(1);
}
