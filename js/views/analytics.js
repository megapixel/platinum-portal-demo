// views/analytics: management dashboard. Charts are plain HTML bars (thin, rounded at the data end, one blue series,
// with a second hue only where two measures are compared). Every chart has its table beside it as the accessible view.
import { esc, fmtMoney } from '../utils.js';
import { LEAD_STAGE_LABEL } from '../domain.js';
import { introducerStats } from '../api/leads.js';
import * as A from '../analytics.js';

const days = (r) => (r.avg == null ? 'n/a' : `${Math.round(r.avg)} days`);
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** One horizontal bar row. `max` fixes the scale so bars compare honestly. */
function barRow(label, value, max, text, tip, cls = '') {
  const w = max ? Math.max(value > 0 ? 1.5 : 0, (value / max) * 100) : 0;
  return `<div class="bar-row"><span class="bl" title="${esc(label)}">${esc(label)}</span>
    <div class="bt"><i class="${cls}" style="width:${w}%" data-tip="${esc(tip || `${label}: ${text}`)}"></i></div><span class="bv">${esc(text)}</span></div>`;
}

export function viewAnalytics() {
  const src = A.leadsBySource();
  const pipe = A.pipeline();
  const won = A.wonThisMonth();
  const stages = A.activeByStage();
  const toDocs = A.avgDaysBetween('ONBOARDED', 'DOCUMENTS_COMPLETE');
  const toSubmit = A.avgDaysBetween('DOCUMENTS_COMPLETE', 'SUBMITTED');
  const appr = A.approval();
  const att = A.avgAttempts();
  const perCons = A.outstandingPerConsultant();
  const rev = A.revenue();
  const intro = introducerStats().sort((a, b) => b.wonValue - a.wonValue || b.leads - a.leads);
  const maxLeads = Math.max(...src.map((s) => s.leads), 1);
  const maxStage = Math.max(...stages.map((s) => s.count), 1);
  const maxMonth = Math.max(...rev.months.map((m) => m.collected), 1);
  const maxOut = Math.max(...perCons.map((c) => c.outstanding), 1);
  const totalMoney = rev.collected + rev.outstanding || 1;

  return `<main class="page wide stack">
    <div><h1 style="font-size:22px">Analytics</h1><p class="muted small">Management view across leads, cases and cash. Based on all records in this demo, including ${A.avgAttempts().n} cases and the archived history.</p></div>
    <section class="kpis kpis-8">
      <div class="card kpi"><div class="num sm">${appr.rate}%</div><div class="lbl">Approval rate (${appr.approved} of ${appr.decided} decided)</div></div>
      <div class="card kpi"><div class="num sm">${days(toDocs)}</div><div class="lbl">Onboarding to documents complete (${toDocs.n} cases)</div></div>
      <div class="card kpi"><div class="num sm">${days(toSubmit)}</div><div class="lbl">Documents complete to submitted (${toSubmit.n} cases)</div></div>
      <div class="card kpi"><div class="num sm">${att.avg == null ? 'n/a' : att.avg.toFixed(2)}</div><div class="lbl">Average attempts per case (${att.reapplied} re-applied)</div></div>
      <div class="card kpi"><div class="num sm">${fmtMoney(pipe.value)}</div><div class="lbl">Open pipeline value (${pipe.count} leads)</div></div>
      <div class="card kpi"><div class="num sm">${fmtMoney(won.value)}</div><div class="lbl">Won this month (${won.count} leads)</div></div>
      <div class="card kpi"><div class="num sm">${fmtMoney(rev.collected)}</div><div class="lbl">Revenue collected</div></div>
      <div class="card kpi ${rev.overdue ? 'alert' : ''}"><div class="num sm">${fmtMoney(rev.outstanding)}</div><div class="lbl">Outstanding (${fmtMoney(rev.overdue)} overdue)</div></div>
    </section>

    <div class="grid-eq">
      <section class="card">
        <h2>Leads by source and conversion</h2>
        <div class="chart">${src.map((s) => barRow(s.label.replace(/ \(.*$/, ''), s.leads, maxLeads, `${s.leads} leads, ${s.conversion}% won`, `${s.label}: ${s.leads} leads, ${s.won} won (${s.conversion}%)`)).join('')}</div>
        <div class="table-wrap" style="margin-top:12px"><table class="data compact"><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Conversion</th><th>Won value</th></tr></thead><tbody>
          ${src.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.leads}</td><td>${s.won}</td><td>${s.conversion}%</td><td>${fmtMoney(s.wonValue)}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="card">
        <h2>Approval rate by nationality</h2>
        <div class="chart">${appr.byNationality.map((n) => barRow(n.nationality, n.rate, 100, `${n.rate}% of ${n.decided}`, `${n.nationality}: ${n.approved} approved of ${n.decided} decided (${n.rate}%)`)).join('')}</div>
        <p class="tiny muted" style="margin-top:6px">Bars show the approval rate. Small samples (fewer than 5 decided) swing a lot.</p>
        <div class="table-wrap" style="margin-top:8px"><table class="data compact"><thead><tr><th>Nationality</th><th>Decided</th><th>Approved</th><th>Rate</th></tr></thead><tbody>
          ${appr.byNationality.map((n) => `<tr><td>${esc(n.nationality)}${n.decided < 5 ? ' <span class="tiny muted">(small sample)</span>' : ''}</td><td>${n.decided}</td><td>${n.approved}</td><td>${n.rate}%</td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>

    <div class="grid-eq">
      <section class="card">
        <h2>Revenue: cash collected by month</h2>
        <div class="cols" role="img" aria-label="Cash collected per month">${rev.months.map((m) => `<div class="col"><span class="cv">${m.collected ? k(m.collected) : ''}</span>
          <div class="ct"><i style="height:${Math.max(m.collected ? 2 : 0, (m.collected / maxMonth) * 100)}%" data-tip="${esc(`${m.label} ${m.year}: ${fmtMoney(m.collected)}`)}"></i></div><span class="cl">${esc(m.label)}</span></div>`).join('')}</div>
        <h3 style="margin-top:16px">Collected vs outstanding</h3>
        <div class="stack-bar" role="img" aria-label="Collected versus outstanding">
          <i class="s1" style="width:${(rev.collected / totalMoney) * 100}%" data-tip="Collected ${esc(fmtMoney(rev.collected))}"></i><i class="s2" style="width:${(rev.outstanding / totalMoney) * 100}%" data-tip="Outstanding ${esc(fmtMoney(rev.outstanding))}"></i>
        </div>
        <div class="legend" style="margin-top:8px"><span><i class="sw s1"></i> Collected ${esc(fmtMoney(rev.collected))}</span><span><i class="sw s2"></i> Outstanding ${esc(fmtMoney(rev.outstanding))} (overdue ${esc(fmtMoney(rev.overdue))})</span></div>
        <div class="table-wrap" style="margin-top:12px"><table class="data compact"><thead><tr><th>Month</th><th>Collected</th></tr></thead><tbody>
          ${rev.months.map((m) => `<tr><td>${esc(m.label)} ${m.year}</td><td>${fmtMoney(m.collected)}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <div class="stack">
        <section class="card">
          <h2>Active cases by stage</h2>
          <div class="chart">${stages.map((s) => barRow(s.label, s.count, maxStage, String(s.count))).join('')}</div>
        </section>
        <section class="card">
          <h2>Open pipeline by stage</h2>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>Stage</th><th>Leads</th><th>Quoted value</th></tr></thead><tbody>
            ${pipe.byStage.map((s) => `<tr><td>${esc(LEAD_STAGE_LABEL[s.key])}</td><td>${s.count}</td><td>${fmtMoney(s.value)}</td></tr>`).join('')}</tbody></table></div>
        </section>
        <section class="card">
          <h2>Outstanding documents per consultant</h2>
          <div class="chart">${perCons.map((c) => barRow(c.name, c.outstanding, maxOut, `${c.outstanding} in ${c.cases} cases`, `${c.name}: ${c.outstanding} outstanding documents, ${c.overdue} overdue cases`)).join('')}</div>
        </section>
      </div>
    </div>

    <section class="card">
      <h2>Introducer leaderboard</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>#</th><th>Introducer</th><th>Tier</th><th>Leads</th><th>Converted</th><th>Conversion</th><th>Won value</th></tr></thead><tbody>
        ${intro.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.intro.name)}</b><div class="tiny muted">${esc(s.intro.org)}</div></td><td>${s.intro.tier === 'PREMIUM' ? '<span class="chip gold plain">&#9733; Premium</span>' : 'Standard'}</td>
          <td>${s.leads}</td><td>${s.won}</td><td>${s.leads ? Math.round((s.won * 100) / s.leads) : 0}%</td><td>${fmtMoney(s.wonValue)}</td></tr>`).join('')}</tbody></table></div>
    </section>
  </main>`;
}
