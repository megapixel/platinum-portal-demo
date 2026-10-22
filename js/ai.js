// ai - analyseDocument(file, mimeType, expected)
// Real mode (production, server side): Claude vision with strict JSON + zod validation.
// This prototype runs the deterministic mock only, so the demo works offline and no API key
// is ever exposed in browser code.
import { DOC_TYPES, DETECT_ORDER, ACCEPTED_MIME, DAY } from './domain.js';
import { fmtDate, daysAgo, hashStr, sleep, sameName } from './utils.js';

function normaliseName(fileName) {
  return String(fileName).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function detectType(fileName) {
  const norm = normaliseName(fileName);
  const tokens = norm.split('_');
  const padded = `_${norm}_`;
  for (const type of DETECT_ORDER) {
    for (const w of DOC_TYPES[type].words) {
      if (w.includes('_') ? padded.includes(`_${w}_`) : (tokens.includes(w) || (w.length > 4 && norm.includes(w)))) return type;
    }
  }
  return null;
}
function mask(value) {
  const s = String(value);
  return s.length <= 4 ? s : s[0] + '•'.repeat(s.length - 4) + s.slice(-3);
}
function fieldValue(field, person, docType) {
  const f = field.toLowerCase();
  const p = person.profile || {};
  const name = person.name.toUpperCase();
  const dob = p.dob ? fmtDate(p.dob) : '01 Jan 1990';
  const year = new Date().getFullYear();
  switch (f) {
    case 'full name': case 'employee name': case 'taxpayer name': case 'member name': return name;
    case 'passport number': return mask(p.passportNo || 'A' + String(hashStr(person.name)).slice(0, 8));
    case 'date of birth': return dob;
    case 'nationality': return (p.nationality || 'Malaysian').toUpperCase();
    case 'expiry date': return fmtDate(new Date(Date.now() + (900 + hashStr(person.name + docType) % 900) * DAY).toISOString());
    case 'fin': return mask('G' + String(hashStr(person.name)).slice(0, 7) + 'K');
    case 'nric number': return mask('S' + String(hashStr(person.name)).slice(0, 7) + 'D');
    case 'rep number': return mask('R' + String(hashStr(person.name)).slice(0, 8));
    case 'pass type': return 'Employment Pass';
    case 'place of birth': return p.birthPlace || 'Kuala Lumpur, Malaysia';
    case "parents' names": return 'Present (2 names)';
    case 'institution': return p.institution || 'Universiti Malaya';
    case 'qualification': return p.qualification || 'Bachelor degree';
    case 'date awarded': return String(Number((p.dob || '1990').slice(0, 4)) + 22);
    case 'employer name': return p.employer || 'Employer Pte Ltd';
    case 'pay period': {
      const end = new Date(); end.setMonth(end.getMonth() - 1);
      const start = new Date(end); start.setMonth(start.getMonth() - 5);
      const m = (d) => d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
      return `${m(start)} to ${m(end)}`;
    }
    case 'gross salary': case 'monthly salary': return `SGD ${p.salary || '6,000'}.00`;
    case 'position': return p.position || 'Manager';
    case 'start date': return fmtDate(new Date(Date.now() - 3 * 365 * DAY).toISOString());
    case 'signatory': return 'Head of Human Resources';
    case 'year of assessment': return `YA ${year}`;
    case 'assessable income': return `SGD ${(Number(String(p.salary || '6000').replace(/,/g, '')) * 13).toLocaleString('en-SG')}`;
    case 'tax payable': return `SGD ${Math.round(Number(String(p.salary || '6000').replace(/,/g, '')) * 13 * 0.07).toLocaleString('en-SG')}`;
    case 'face clearly visible': case 'plain white background': return 'Yes';
    case 'names of both parties': return 'Present';
    case 'date of marriage': return fmtDate(`${Number((p.dob || '1990').slice(0, 4)) + 27}-06-12`);
    case 'place of registration': return 'Registry of Marriages, Singapore';
    case 'address': return 'Blk 123 Ang Mo Kio Ave 3, #08-411';
    case 'statement period': {
      const m = (d) => d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
      const end = new Date(); const start = new Date(end); start.setMonth(start.getMonth() - 11);
      return `${m(start)} to ${m(end)}`;
    }
    case 'employer contributions': return 'Present for 12 months';
    default: return 'Present';
  }
}

const NAME_FIELD = /^(full name|employee name|taxpayer name|member name)$/i;

/** Pure, synchronous mock used by the seed and by analyseDocument(). */
export function mockAnalyse({ fileName, docType, label, requiredFields, person }) {
  const norm = normaliseName(fileName);
  const detected = detectType(fileName);
  const expectedType = docType || 'other';
  const expectedLabel = DOC_TYPES[expectedType] && expectedType !== 'other' ? DOC_TYPES[expectedType].label : label.toLowerCase();
  const extracted = {};
  const issues = [];
  const jitter = (hashStr(norm) % 7) / 100;

  if (detected && detected !== expectedType && expectedType !== 'other') {
    requiredFields.forEach((f) => { extracted[f] = /name/.test(f) && !/employer|parents|both/.test(f) ? person.name.toUpperCase() : null; });
    issues.push(`This looks like a ${DOC_TYPES[detected].label}, but we expected a ${expectedLabel}. Please check.`);
    return { detectedType: detected, matchesExpected: false, confidence: 0.86 + jitter, extracted, issues };
  }

  requiredFields.forEach((f) => { extracted[f] = fieldValue(f, person, expectedType); });
  const type = detected || expectedType;
  let confidence = detected ? 0.9 + jitter : 0.55 + jitter;

  // Demo hook: a filename containing "mismatch" simulates a document that carries a different name.
  if (norm.includes('mismatch')) {
    const parts = person.name.toUpperCase().split(/\s+/);
    parts[parts.length - 1] = parts[parts.length - 1] === 'LEE' ? 'WONG' : 'LEE';
    requiredFields.forEach((f) => { if (NAME_FIELD.test(f)) extracted[f] = parts.join(' '); });
  }
  if (norm.includes('blurry') || norm.includes('blur')) {
    const target = requiredFields.find((f) => f.toLowerCase() === 'expiry date') || requiredFields[requiredFields.length - 1];
    extracted[target] = null;
    issues.push(`The ${target} is not readable. Please upload a clearer copy.`);
    confidence = 0.68 + jitter;
  }
  if (norm.includes('expired') && 'expiry date' in extracted) {
    extracted['expiry date'] = fmtDate(daysAgo(40));
    issues.push(`This document expired on ${extracted['expiry date']}. Please upload a valid one.`);
  }
  if (norm.includes('page1') || norm.includes('partial')) {
    issues.push('Some pages appear to be missing. Please upload the complete document.');
  }
  return { detectedType: type, matchesExpected: true, confidence: Math.min(confidence, 0.99), extracted, issues };
}

/**
 * Compares the name read from a document with the name on the client's onboarding form.
 * Returns an issue string, or null. Only main applicant documents are checked.
 */
export function crossCheckName(extracted, formName) {
  if (!formName) return null;
  const key = Object.keys(extracted || {}).find((k) => NAME_FIELD.test(k));
  const found = key && extracted[key];
  if (!found || sameName(found, formName)) return null;
  return `The name on this document (${found}) does not match the name on your information form (${String(formName).toUpperCase()}).`;
}

export const documentReader = {
  mode: 'mock',
  /**
   * analyseDocument(file, mimeType, expected) => { detectedType, matchesExpected, confidence, extracted, issues }
   * `expected` carries { label, requiredFields } as per the brief, plus docType and person for the mock.
   */
  async analyseDocument(file, mimeType, expected) {
    await sleep(1300); // makes "Checking your document..." visible, like a real model call
    if (!ACCEPTED_MIME.includes(mimeType)) {
      return { detectedType: 'other', matchesExpected: false, confidence: 0, extracted: {}, issues: ['Unsupported file type.'] };
    }
    return mockAnalyse({ fileName: file.name, docType: expected.docType, label: expected.label, requiredFields: expected.requiredFields, person: expected.person });
  },
};

/** Plain-language summary shown to the client after the check. */
export function clientResultMessage(doc) {
  if (doc.aiMatches && !doc.aiIssues.length) {
    if (doc.aiConfidence < 0.7) return 'Thanks, we received your document. Our team will confirm it shortly.';
    const t = DOC_TYPES[doc.aiDetectedType];
    const article = /^[aeiou]/i.test(t.label) ? 'an' : 'a';
    return `Looks like ${article} ${t.label}. All required details found.`;
  }
  return doc.aiIssues.join(' ');
}
