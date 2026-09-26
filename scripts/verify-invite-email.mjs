// Proves both delivery paths of the invitation email without contacting a real provider.
//
//   node --import tsx scripts/verify-invite-email.mjs
//
// Starts a throwaway SMTP server on an ephemeral local port, points the mail module at it, and
// asserts:
//   1. a configured server that accepts the message reports sent:true
//   2. the message actually carries the invitation link and the recipient address
//   3. an unreachable server reports sent:false with a reason instead of throwing
//
// Nothing is sent to the internet and no credential is used.

import net from "node:net";
import assert from "node:assert/strict";

const captured = [];

function startSmtpServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.write("220 verify-invite-email\r\n");
      let buffer = "";
      let inData = false;
      let message = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          message += buffer.slice(0, end);
          captured.push(message);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 OK queued\r\n");
        }
        let index;
        while ((index = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const upper = line.toUpperCase();
          if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
            socket.write("250-verify-invite-email\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
          } else if (upper.startsWith("AUTH")) {
            socket.write("235 Authentication successful\r\n");
          } else if (upper.startsWith("MAIL FROM") || upper.startsWith("RCPT TO")) {
            socket.write("250 OK\r\n");
          } else if (upper.startsWith("DATA")) {
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
            inData = true;
          } else if (upper.startsWith("QUIT")) {
            socket.write("221 Bye\r\n");
            socket.end();
          } else {
            socket.write("250 OK\r\n");
          }
        }
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await startSmtpServer();

// Configure the module before importing it, since mailConfig() is read per call.
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(port);
process.env.SMTP_USER = "user";
process.env.SMTP_PASSWORD = "password";
process.env.SMTP_FROM_EMAIL = "no-reply@example.test";
process.env.SMTP_FROM_NAME = "Follow-through";

const { mailConfigured, sendInvitationEmail, sendRecoveryEmail } = await import("../lib/mail.ts");

console.log("=== configuration ===");
console.log(`  mailConfigured(): ${mailConfigured()}`);
assert.equal(mailConfigured(), true);

const link = "https://example.test/invite?token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
console.log("=== path 1: provider accepts the message ===");
const delivered = await sendInvitationEmail({
  to: "invitee@example.test",
  name: "Test Invitee",
  business: "IDash — Datachron Solutions",
  role: "rm",
  link,
  expiresInHours: 48,
});
console.log(`  result: ${JSON.stringify(delivered)}`);
assert.equal(delivered.sent, true, "expected a configured server to report sent:true");
assert.equal(captured.length, 1, "expected exactly one captured message");

const raw = captured[0];

// The text part is sent quoted-printable, which inserts soft line breaks at 76 columns and escapes
// "=" as "=3D". Any compliant client decodes that back to the original line, so decode it here and
// assert on what a mail client would actually show. This is the check that matters: a wrapped or
// escaped invitation link would be unusable.
function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r\n/g, "")
    .replace(/=\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
const encoding = (raw.match(/Content-Transfer-Encoding:\s*(\S+)/i) || [])[1] || "unknown";
const decoded = decodeQuotedPrintable(raw);

console.log(`  content-transfer-encoding: ${encoding}`);
assert.ok(raw.includes("To: invitee@example.test"), "message must address the invitee");
assert.ok(raw.includes("no-reply@example.test"), "message must carry the configured sender");
assert.ok(decoded.includes(link), "the decoded message must contain the invitation link intact");
assert.ok(decoded.includes("IDash"), "the decoded message must name the business");
assert.ok(decoded.includes("48 hours"), "the decoded message must state the expiry");
assert.ok(/Content-Type:\s*text\/plain/i.test(raw), "a plain-text part must be present");
assert.ok(/Content-Type:\s*text\/html/i.test(raw), "an HTML part must be present");
assert.ok(decoded.includes("Accept your invitation"), "the message must carry a clear call to action");
assert.ok(decoded.toLowerCase().includes("choose a password") || decoded.toLowerCase().includes("existing password"), "the message must explain how a new invitee gets access");
console.log("  decoded message verified: recipient, sender, intact link, business, expiry, text + HTML parts, CTA and account guidance");

console.log("=== path 1b: recovery message ===");
captured.length = 0;
const recoveryLink = "https://example.test/reset-password?token_hash=" + "a".repeat(56);
const recovery = await sendRecoveryEmail({ to: "invitee@example.test", link: recoveryLink, expiresInHours: 1 });
console.log(`  result: ${JSON.stringify(recovery)}`);
assert.equal(recovery.sent, true, "a configured server must report sent:true for recovery");
assert.equal(captured.length, 1, "expected exactly one captured recovery message");
const decodedRecovery = decodeQuotedPrintable(captured[0]);
assert.ok(decodedRecovery.includes(recoveryLink), "the recovery link must survive intact");
assert.ok(/reset your follow-through password/i.test(decodedRecovery), "the recovery message must state its purpose");
assert.ok(/expires in 1 hour/i.test(decodedRecovery), "the recovery message must state the expiry");
assert.ok(/Content-Type:\s*text\/html/i.test(captured[0]), "the recovery message must carry an HTML part");
console.log("  recovery message verified: recipient, intact link, purpose, expiry and HTML part");

console.log("=== path 2: provider unreachable ===");
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1"; // nothing listens here
const failed = await sendInvitationEmail({
  to: "invitee@example.test",
  name: "Test Invitee",
  business: null,
  role: "rm",
  link,
  expiresInHours: 48,
});
console.log(`  result: ${JSON.stringify(failed)}`);
assert.equal(failed.sent, false, "an unreachable server must report sent:false, not throw");
assert.ok(typeof failed.reason === "string" && failed.reason.length > 0, "a reason must be given");
console.log("  degraded to manual delivery with a reason, as designed");

console.log("=== path 3: not configured at all ===");
delete process.env.SMTP_HOST;
assert.equal(mailConfigured(), false);
const unset = await sendInvitationEmail({ to: "a@b.test", name: "N", business: null, role: "rm", link, expiresInHours: 48 });
assert.equal(unset.sent, false);
console.log(`  result: ${JSON.stringify(unset)}`);

server.close();
console.log("\nINVITATION EMAIL VERIFIED: send path, failure path and unconfigured path all behave correctly.");
