import nodemailer from "nodemailer";
import { readEnv } from "./env";

/**
 * Outbound transactional email.
 *
 * Configuration is optional on purpose. A business that has not configured a mail provider must
 * still be able to create invitations and accept them; it simply falls back to handing the
 * administrator a single-use link. Nothing here ever claims a message was delivered unless the
 * provider accepted it, and no token, password or recipient list is written to a log.
 */

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

export function mailConfig(): MailConfig | null {
  const host = readEnv("SMTP_HOST");
  const port = readEnv("SMTP_PORT");
  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASSWORD");
  const from = readEnv("SMTP_FROM_EMAIL");
  const values = [host, port, user, pass, from];
  if (values.some((v) => !v || v.includes("["))) return null;
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) return null;
  return {
    host: host as string,
    port: portNumber,
    user: user as string,
    pass: pass as string,
    from: from as string,
    fromName: readEnv("SMTP_FROM_NAME") || (from as string),
  };
}

export function mailConfigured(): boolean {
  return mailConfig() !== null;
}

export type MailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends an invitation. A failure is returned, never thrown: the invitation row already exists and
 * the administrator must still be given the link, so a mail outage degrades to manual delivery
 * instead of losing the invitation or reporting a false success.
 */
export async function sendInvitationEmail(input: {
  to: string;
  name: string;
  business: string | null;
  role: string;
  link: string;
  expiresInHours: number;
}): Promise<MailResult> {
  const config = mailConfig();
  if (!config) return { sent: false, reason: "Email is not configured on this server." };

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const place = input.business ?? "Follow-through";
  const subject = `You are invited to join ${place}`;
  const body = [
    `Hello ${input.name},`,
    "",
    `${place} has invited you to join Follow-through as ${input.role}.`,
    "",
    "Open this link to accept:",
    input.link,
    "",
    `You do not need to be signed in yet. If you already have an account for ${input.to}, sign in when the page asks.`,
    `If you do not, the link lets you create one with ${input.to}. Then accept the invitation.`,
    `It expires in ${input.expiresInHours} hours and can be used once.`,
    "",
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");
  const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
  const html = [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,'Segoe UI',sans-serif;color:#172536">`,
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e1e7ed;border-radius:12px;padding:32px">`,
    `<p style="margin:0 0 6px;font-size:11px;letter-spacing:1.6px;font-weight:700;color:#657486">FOLLOW-THROUGH</p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#122233">You are invited to join ${esc(place)}</h1>`,
    `<p style="margin:0 0 18px">Hello ${esc(input.name)},</p>`,
    `<p style="margin:0 0 20px">${esc(place)} has invited you to join Follow-through as <strong>${esc(input.role)}</strong>.</p>`,
    `<p style="margin:0 0 22px"><a href="${esc(input.link)}" style="display:inline-block;background:#122233;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Accept your invitation</a></p>`,
    `<p style="margin:0 0 16px;color:#3c4b5c">You do not need to be signed in yet. When the page opens, sign in &mdash; or create an account &mdash; with <strong>${esc(input.to)}</strong>, then accept. The invitation expires in ${input.expiresInHours} hours and can be used once.</p>`,
    `<p style="margin:0;font-size:12px;color:#657486">If you were not expecting this, you can ignore this message.</p>`,
    `</div></body></html>`,
  ].join("");

  try {
    await transport.sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to: input.to,
      subject,
      text: body,
      html,
    });
    return { sent: true };
  } catch (error) {
    const reason = String((error as Error).message ?? error).split("\n")[0];
    return { sent: false, reason };
  } finally {
    transport.close();
  }
}
