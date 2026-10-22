// notify: sends a rendered template to a client over their preferred channel (WhatsApp, email, or both).
import { store } from './store.js';
import { messaging } from './providers/messaging.js';
import { emailer } from './providers/email.js';
import { renderMessage } from './messagetemplates.js';
import { firstName } from './utils.js';

/**
 * notifyClient(client, { caseId, trigger, templateKey, vars, link })
 * Channel = the client's preference (WHATSAPP | EMAIL | BOTH), narrowed by the template's channel
 * (a WHATSAPP-only template never goes out by email). Returns the messages created.
 */
export async function notifyClient(client, { caseId, trigger, templateKey, vars, link }) {
  const contact = store.primaryContact(client);
  const allVars = { firstName: firstName(client.name), link: link || '', ...vars };
  const msg = renderMessage(templateKey, allVars);
  const pref = client.channelPref || 'WHATSAPP';
  const wantWa = (pref === 'WHATSAPP' || pref === 'BOTH') && (msg.channel === 'WHATSAPP' || msg.channel === 'BOTH');
  let wantEmail = (pref === 'EMAIL' || pref === 'BOTH') && (msg.channel === 'EMAIL' || msg.channel === 'BOTH');
  // A client who prefers email still gets WhatsApp-only templates by email rather than nothing.
  if (!wantWa && !wantEmail) wantEmail = pref === 'EMAIL';
  const out = [];
  if (wantWa) out.push(await messaging.send({ caseId, toPhone: contact.phone, toName: client.name, body: msg.body, link, trigger }));
  if (wantEmail) out.push(await emailer.send({ caseId, to: contact.email, toName: client.name, subject: msg.subject, body: msg.body, link, trigger }));
  return out;
}
