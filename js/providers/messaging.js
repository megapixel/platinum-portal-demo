// messaging - MessagingProvider interface
import { db } from '../store.js';
import { uid, nowIso } from '../utils.js';

/**
 * interface MessagingProvider {
 *   channel: 'WHATSAPP';
 *   send(msg: { caseId?, leadId?, toPhone, toName?, body, link?, trigger }): Promise<OutboxMessage>;
 * }
 */
export class MockWhatsAppProvider {
  constructor() { this.channel = 'WHATSAPP'; }
  async send({ caseId, leadId, toPhone, toName, body, link, trigger }) {
    const msg = { id: uid('msg'), caseId: caseId || null, leadId: leadId || null, channel: this.channel, toPhone, toName: toName || null, body, link: link || null, trigger, status: 'QUEUED', createdAt: nowIso(), sentAt: null };
    db.outbox.unshift(msg);
    // Simulated delivery: the mock marks messages as sent immediately.
    msg.status = 'SENT';
    msg.sentAt = nowIso();
    return msg;
  }
}

export class WhatsAppCloudApiProvider {
  constructor(config) { this.channel = 'WHATSAPP'; this.config = config; }
  async send() {
    // TODO: call the WhatsApp Business Cloud API (or the client's CRM WhatsApp channel, platform TBC)
    //   POST https://graph.facebook.com/v{ver}/{phone_number_id}/messages with an approved template.
    // TODO: weekly reminders fall outside the 24h service window, so they need a pre-approved template.
    // TODO: store the provider message id and update status from delivery webhooks.
    throw new Error('WhatsAppCloudApiProvider is not implemented in the prototype.');
  }
}

export const messaging = new MockWhatsAppProvider();
