'use strict';

let reviewsData = null;
let selectedRunId = null;

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function initial(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderDocList() {
  const list = document.getElementById('doc-list');
  if (!reviewsData.documents.length) {
    list.innerHTML = '<div class="rv-loading">No reviews yet. Run a playbook review from the main app.</div>';
    return;
  }
  list.innerHTML = reviewsData.documents.map(doc => `
    <div class="rv-doc-group">
      <div class="rv-doc-name" title="${escHtml(doc.contractName)}">${escHtml(shortName(doc.contractName))}</div>
      ${doc.runs.map((run, idx) => `
        <div class="rv-run-item ${run.id === selectedRunId ? 'active' : ''}" onclick="selectRun('${escHtml(run.id)}')">
          <div class="rv-run-left">
            <span class="rv-run-date">${fmtDateShort(run.createdAt)}</span>
            <span class="rv-run-meta">Run #${doc.runs.length - idx}</span>
          </div>
          <div class="rv-run-badges">
            <span class="rv-badge rv-badge-issues">${run.issues.length}i</span>
            ${run.evaluations.length ? `<span class="rv-badge rv-badge-evals">${run.evaluations.length}e</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function shortName(name) {
  // Strip long path-like prefixes from filename
  const parts = name.split(/[/\\]/);
  const base = parts[parts.length - 1];
  return base.length > 36 ? base.slice(0, 34) + '…' : base;
}

// ── Run detail ────────────────────────────────────────────────────────────────

function selectRun(runId) {
  selectedRunId = runId;
  renderDocList(); // update active state
  renderRunDetail();
}

function findRun(runId) {
  for (const doc of reviewsData.documents) {
    const run = doc.runs.find(r => r.id === runId);
    if (run) return { run, doc };
  }
  return null;
}

function renderRunDetail() {
  const detail = document.getElementById('run-detail');
  if (!selectedRunId) return;
  const found = findRun(selectedRunId);
  if (!found) return;
  const { run, doc } = found;
  const docIdx = doc.runs.indexOf(run);
  const runNumber = doc.runs.length - docIdx;

  // Compute metrics across all evaluators
  const allGradesByIssue = {}; // { issueIdx: [{ evaluator, verdict, comment }] }
  for (const ev of run.evaluations) {
    for (const [idx, grade] of Object.entries(ev.grades)) {
      if (!allGradesByIssue[idx]) allGradesByIssue[idx] = [];
      allGradesByIssue[idx].push({ evaluator: ev.evaluator, submittedAt: ev.submittedAt, verdict: grade.verdict, comment: grade.comment });
    }
  }

  const gradedIssues = Object.values(allGradesByIssue).filter(grades => grades.some(g => g.verdict));
  const agree    = gradedIssues.filter(gs => gs.some(g => g.verdict === 'agree')).length;
  const partial  = gradedIssues.filter(gs => gs.some(g => g.verdict === 'partial')).length;
  const disagree = gradedIssues.filter(gs => gs.some(g => g.verdict === 'disagree')).length;

  const evaluatorChips = run.evaluations.map(ev => `
    <div class="rv-evaluator-chip">
      <div class="rv-evaluator-avatar">${escHtml(initial(ev.evaluator))}</div>
      <span>${escHtml(ev.evaluator)}</span>
      <span class="rv-evaluator-time">${fmtDateShort(ev.submittedAt)}</span>
    </div>
  `).join('');

  const issuesHtml = run.issues.map((issue, i) => {
    const issueGrades = (allGradesByIssue[i] || []).filter(g => g.verdict || g.comment);
    const evalsHtml = issueGrades.length
      ? `<div class="rv-issue-evals">${issueGrades.map(g => `
          <div class="rv-issue-eval-row">
            <span class="rv-verdict-badge ${g.verdict || 'none'}">${g.verdict || 'no verdict'}</span>
            <div>
              <div class="rv-eval-meta">${escHtml(g.evaluator)} · ${fmtDateShort(g.submittedAt)}</div>
              ${g.comment ? `<div class="rv-eval-comment">${escHtml(g.comment)}</div>` : ''}
            </div>
          </div>
        `).join('')}</div>`
      : `<div class="rv-no-evals">No evaluator feedback on this issue.</div>`;

    return `
      <div class="rv-issue-card">
        <div class="rv-issue-header">
          <span class="rv-sev-dot ${escHtml(issue.severity)}"></span>
          <span class="rv-issue-clause">${escHtml(issue.clause || issue.playbookSection || 'Unknown clause')}</span>
          <span class="rv-sev-badge ${escHtml(issue.severity)}">${escHtml(issue.severity?.replace('_', ' ') || '')}</span>
        </div>
        <div class="rv-issue-body">
          <div class="rv-issue-deviation">${escHtml(issue.deviation)}</div>
          ${issue.counterpartyText ? `<div class="rv-issue-quote">"${escHtml(issue.counterpartyText)}"</div>` : ''}
        </div>
        ${evalsHtml}
      </div>
    `;
  }).join('');

  const missedHtml = run.evaluations.flatMap(ev =>
    (ev.missedIssues || []).map(m => ({ ...m, evaluator: ev.evaluator, submittedAt: ev.submittedAt }))
  );

  const missedSection = missedHtml.length ? `
    <div class="rv-section-label">Missed issues (flagged by evaluators)</div>
    <div class="rv-issues">
      ${missedHtml.map(m => `
        <div class="rv-issue-card">
          <div class="rv-issue-header">
            <span class="rv-sev-dot ${escHtml(m.severity || 'negotiate')}"></span>
            <span class="rv-issue-clause">${escHtml(m.clause || 'Unlabelled')}</span>
            <span class="rv-sev-badge ${escHtml(m.severity || 'negotiate')}">${escHtml((m.severity || 'negotiate').replace('_', ' '))} — missed</span>
          </div>
          <div class="rv-issue-body">
            ${m.selectedText ? `<div class="rv-issue-quote">"${escHtml(m.selectedText)}"</div>` : ''}
            ${m.comment ? `<div class="rv-issue-deviation">${escHtml(m.comment)}</div>` : ''}
          </div>
          <div class="rv-issue-evals">
            <div class="rv-issue-eval-row">
              <span class="rv-verdict-badge disagree">missed by AI</span>
              <div class="rv-eval-meta">${escHtml(m.evaluator)} · ${fmtDateShort(m.submittedAt)}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  detail.innerHTML = `
    <div class="rv-run-header">
      <div class="rv-run-title">Run #${runNumber} — ${escHtml(shortName(doc.contractName))}</div>
      <div class="rv-run-submeta">
        <span>${fmtDate(run.createdAt)}</span>
        <span class="rv-run-submeta-sep">·</span>
        <span>${run.issues.length} issues found</span>
        <span class="rv-run-submeta-sep">·</span>
        <span>${run.model}</span>
      </div>
    </div>

    ${run.evaluations.length ? `
      <div class="rv-metrics">
        <div class="rv-metric-card">
          <div class="rv-metric-val">${run.evaluations.length}</div>
          <div class="rv-metric-label">Evaluation${run.evaluations.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="rv-metric-card agree">
          <div class="rv-metric-val">${agree}</div>
          <div class="rv-metric-label">Agreed</div>
        </div>
        <div class="rv-metric-card partial">
          <div class="rv-metric-val">${partial}</div>
          <div class="rv-metric-label">Partial</div>
        </div>
        <div class="rv-metric-card disagree">
          <div class="rv-metric-val">${disagree}</div>
          <div class="rv-metric-label">Disagreed</div>
        </div>
      </div>
      <div class="rv-evaluators">${evaluatorChips}</div>
    ` : ''}

    <div class="rv-section-label">AI-identified issues</div>
    <div class="rv-issues">${issuesHtml}</div>
    ${missedSection}
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const r = await fetch('/api/reviews');
    reviewsData = await r.json();
    renderDocList();
    // Auto-select first run if available
    if (reviewsData.documents[0]?.runs[0]) {
      selectRun(reviewsData.documents[0].runs[0].id);
    }
  } catch (e) {
    document.getElementById('doc-list').innerHTML = `<div class="rv-loading" style="color:#ef4444">Failed to load: ${e.message}</div>`;
  }
}

init();
