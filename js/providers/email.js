// email - EmailProvider interface (mocked). Production: SES, SendGrid or Microsoft 365 SMTP.
import { db } from '../store.js';
import { uid, nowIso } from '../utils.js';

/**
 * interface EmailProvider {
 *   channel: 'EMAIL';
 *   send(msg: { caseId?, leadId?, to, toName?, subject, body, link?, trigger }): Promise<EmailMessage>;
 * }
 */
export class MockEmailProvider {
  constructor() { this.channel = 'EMAIL'; }
  async send({ caseId, leadId, to, toName, subject, body, link, trigger }) {
    const msg = { id: uid('em'), caseId: caseId || null, leadId: leadId || null, channel: this.channel, to, toName: toName || null, subject, body, link: link || null, trigger, status: 'QUEUED', createdAt: nowIso(), sentAt: null };
    db.emails.unshift(msg);
    msg.status = 'SENT';
    msg.sentAt = nowIso();
    return msg;
  }
}

export class SmtpEmailProvider {
  constructor(config) { this.channel = 'EMAIL'; this.config = config; }
  async send() {
    // TODO: send through the chosen email service and record bounces and delivery status from webhooks.
    throw new Error('SmtpEmailProvider is not implemented in the prototype.');
  }
}

export const emailer = new MockEmailProvider();
