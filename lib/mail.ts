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

  const where = input.business ? `${input.business} on Follow-through` : "Follow-through";
  const subject = `You have been invited to ${input.business ?? "Follow-through"}`;
  const body = [
    `Hello ${input.name},`,
    "",
    `You have been invited to join ${where} with the role: ${input.role}.`,
    "",
    `Open this link to accept, within ${input.expiresInHours} hours:`,
    input.link,
    "",
    `Sign in with ${input.to} first, then open the link. The invitation works once.`,
    "",
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");

  try {
    await transport.sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to: input.to,
      subject,
      text: body,
    });
    return { sent: true };
  } catch (error) {
    const reason = String((error as Error).message ?? error).split("\n")[0];
    return { sent: false, reason };
  } finally {
    transport.close();
  }
}
