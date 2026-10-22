// caselogic: pure helpers that build cases from templates. No db access.
import { addMonths } from './utils.js';

export function personList(client) {
  const people = [{ label: 'Main applicant', appliesTo: 'MAIN', name: client.name, profile: client.profile }];
  let child = 0;
  for (const dep of client.dependants || []) {
    if (dep.relation === 'SPOUSE') people.push({ label: 'Spouse', appliesTo: 'SPOUSE', name: dep.name, profile: dep });
    if (dep.relation === 'CHILD') people.push({ label: `Child ${++child}`, appliesTo: 'CHILD', name: dep.name, profile: dep });
  }
  return people;
}

/** Turns a template into case checklist items (snapshotting labels so template edits only affect new cases). */
export function instantiateItems(template, caseRec, people, married) {
  const items = [];
  for (const p of people) {
    for (const t of template.items.filter((x) => x.appliesTo === p.appliesTo)) {
      if (t.docType === 'marriage_certificate' && !married) continue;
      items.push({
        id: `${caseRec.id}_${t.code}${p.label.startsWith('Child') ? '_' + p.label.split(' ')[1] : ''}`,
        caseId: caseRec.id,
        templateItemId: t.id,
        code: t.code,
        label: t.label,
        description: t.description,
        // "If married" items become required once we know the client is married.
        required: t.docType === 'marriage_certificate' ? true : t.required,
        docType: t.docType,
        requiredFields: t.requiredFields.slice(),
        personLabel: p.label,
        personName: p.name,
        sortOrder: t.sortOrder,
        status: 'PENDING',
        staffRemark: null,
        rejectedAt: null,
        dueDate: null,
        updatedAt: caseRec.createdAt,
      });
    }
  }
  return items;
}

export const defaultTargetDate = (startIso) => addMonths(startIso, 2);

/** { pct, done, total } for an onboarding form definition and the saved answers. */
export function formProgress(formDef, data) {
  const required = formDef ? formDef.sections.flatMap((s) => s.fields).filter((f) => f.required) : [];
  const done = required.filter((f) => String((data || {})[f.key] == null ? '' : data[f.key]).trim() !== '').length;
  return { done, total: required.length, pct: required.length ? Math.round((done * 100) / required.length) : 100 };
}
