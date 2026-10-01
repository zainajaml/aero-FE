import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SentEmail = OutgoingEmail & { messageId: string };

export interface EmailTransport {
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

/** Captures messages instead of delivering them; selected with SMTP_URL=memory:// (tests only). */
export class MemoryEmailTransport implements EmailTransport {
  readonly sent: SentEmail[] = [];

  async send(message: OutgoingEmail) {
    const messageId = `memory-${this.sent.length + 1}`;
    this.sent.push({ ...message, messageId });
    return { messageId };
  }
}

class SmtpEmailTransport implements EmailTransport {
  private readonly transporter = nodemailer.createTransport(env.SMTP_URL);

  async send(message: OutgoingEmail) {
    const info = await this.transporter.sendMail({ from: env.EMAIL_FROM, ...message });
    return { messageId: String(info.messageId) };
  }
}

export const emailTransport: EmailTransport =
  env.SMTP_URL === "memory://" ? new MemoryEmailTransport() : new SmtpEmailTransport();
