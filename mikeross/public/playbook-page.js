'use strict';

let playbookData = null;
let isDirty = false;
const openSections = new Set();
let selectedClause = null; // { si, ci }

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markDirty() {
  isDirty = true;
  const el = document.getElementById('save-status');
  el.textContent = 'Unsaved changes';
  el.className = 'pb-save-status dirty';
}

function markClean() {
  isDirty = false;
  const el = document.getElementById('save-status');
  el.textContent = 'Saved';
  el.className = 'pb-save-status clean';
  setTimeout(() => { if (!isDirty) { el.textContent = ''; el.className = 'pb-save-status'; } }, 2500);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.pb-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.pb-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tab));
}

// ── Clause rendering ──────────────────────────────────────────────────────────

function renderArrayItems(items, si, ci, fieldName, placeholder, multiline) {
  if (!items || items.length === 0) {
    return `<div class="pb-array-empty">None added yet.</div>`;
  }
  return items.map((item, idx) => `
    <div class="pb-array-row">
      ${multiline
        ? `<textarea class="pb-field-ta pb-array-ta" rows="2" data-section="${si}" data-clause="${ci}" data-arrayfield="${fieldName}" data-item="${idx}" placeholder="${placeholder}">${escHtml(item)}</textarea>`
        : `<input type="text" class="pb-field-input pb-array-input" data-section="${si}" data-clause="${ci}" data-arrayfield="${fieldName}" data-item="${idx}" placeholder="${placeholder}" value="${escHtml(item)}">`
      }
      <button class="pb-array-remove" onclick="removeArrayItem(${si},${ci},'${fieldName}',${idx})" title="Remove">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

function renderFallbackPositions(positions, si, ci) {
  const labels = ['1st position', '2nd position', '3rd position'];
  return positions.map((pos, idx) => `
    <div class="pb-fallback-row">
      <span class="pb-fallback-label">${labels[idx] || (idx + 1) + 'th'}</span>
      <textarea class="pb-field-ta pb-fallback-ta" rows="2"
                data-section="${si}" data-clause="${ci}" data-arrayfield="fallbackPositions" data-item="${idx}"
                placeholder="${labels[idx] || 'Fallback option'}…">${escHtml(pos)}</textarea>
      ${positions.length > 1 ? `<button class="pb-array-remove" onclick="removeArrayItem(${si},${ci},'fallbackPositions',${idx})" title="Remove">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>` : ''}
    </div>
  `).join('');
}

function renderClause(clause, si, ci) {
  const isSelected = selectedClause && selectedClause.si === si && selectedClause.ci === ci;
  const escalationItems   = clause.escalationTriggers      || [];
  const checklistItems    = clause.checklist               || [];
  const fallbackItems     = clause.fallbackPositions       || ['', '', ''];
  const dilutionItems     = clause.nonPermissibleDilutions || [];
  const lawItems          = clause.applicableLaw           || [];

  return `
    <div class="pb-clause ${isSelected ? 'selected' : ''}" data-section="${si}" data-clause="${ci}" onclick="selectClauseFromEl(event,${si},${ci})">
      <div class="pb-clause-top">
        <textarea class="pb-field-ta pb-clause-issue-ta" rows="1"
                  data-section="${si}" data-clause="${ci}" data-field="issue"
                  placeholder="Issue — what the counterparty typically asks…">${escHtml(clause.issue)}</textarea>
        <button class="pb-btn-icon" onclick="deleteClause(${si}, ${ci})" title="Remove clause">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="pb-clause-body">
        <div class="pb-clause-col">

          <div class="pb-field">
            <label class="pb-field-label">Clause Extract</label>
            <div class="pb-field-hint">Standard or ideal clause text</div>
            <textarea class="pb-field-ta" rows="4" data-section="${si}" data-clause="${ci}" data-field="clauseExtract" placeholder="The preferred clause language…">${escHtml(clause.clauseExtract || '')}</textarea>
          </div>

          <div class="pb-field">
            <label class="pb-field-label">Compliance Rationale</label>
            <div class="pb-field-hint">Why this clause matters legally</div>
            <textarea class="pb-field-ta" rows="3" data-section="${si}" data-clause="${ci}" data-field="complianceRationale" placeholder="Legal basis or risk explanation…">${escHtml(clause.complianceRationale || '')}</textarea>
          </div>

          <div class="pb-field">
            <div class="pb-array-header">
              <label class="pb-field-label">Applicable Law</label>
              <button class="pb-btn-sm" onclick="addArrayItem(${si},${ci},'applicableLaw')">+ Add</button>
            </div>
            ${renderArrayItems(lawItems, si, ci, 'applicableLaw', 'e.g. GDPR Art. 28…', false)}
          </div>

          <div class="pb-field">
            <div class="pb-array-header">
              <label class="pb-field-label pb-label-danger">Escalation Triggers</label>
              <button class="pb-btn-sm" onclick="addArrayItem(${si},${ci},'escalationTriggers')">+ Add</button>
            </div>
            <div class="pb-field-hint">Hard stop if any of these conditions appear in the counterparty contract</div>
            ${renderArrayItems(escalationItems, si, ci, 'escalationTriggers', 'Condition that triggers escalation…', true)}
          </div>

        </div>
        <div class="pb-clause-col">

          <div class="pb-field">
            <div class="pb-array-header">
              <label class="pb-field-label pb-label-check">Checklist</label>
              <button class="pb-btn-sm" onclick="addArrayItem(${si},${ci},'checklist')">+ Add</button>
            </div>
            <div class="pb-field-hint">Minimum requirements that must appear in any accepted version</div>
            ${renderArrayItems(checklistItems, si, ci, 'checklist', 'Required element…', true)}
          </div>

          <div class="pb-field">
            <div class="pb-array-header">
              <label class="pb-field-label pb-label-fallback">Fallback Positions</label>
              ${fallbackItems.length < 3 ? `<button class="pb-btn-sm" onclick="addArrayItem(${si},${ci},'fallbackPositions')">+ Add</button>` : ''}
            </div>
            <div class="pb-field-hint">Ordered from preferred to minimum acceptable</div>
            ${renderFallbackPositions(fallbackItems, si, ci)}
          </div>

          <div class="pb-field">
            <label class="pb-field-label">General Notes</label>
            <textarea class="pb-field-ta" rows="3" data-section="${si}" data-clause="${ci}" data-field="generalNotes" placeholder="Context, history, or internal guidance…">${escHtml(clause.generalNotes || '')}</textarea>
          </div>

          <div class="pb-field">
            <div class="pb-array-header">
              <label class="pb-field-label pb-label-danger">Non-Permissible Dilutions</label>
              <button class="pb-btn-sm" onclick="addArrayItem(${si},${ci},'nonPermissibleDilutions')">+ Add</button>
            </div>
            <div class="pb-field-hint">Language that must never appear — reject without negotiation</div>
            ${renderArrayItems(dilutionItems, si, ci, 'nonPermissibleDilutions', 'Language to always reject…', true)}
          </div>

        </div>
      </div>
    </div>
  `;
}

function renderSection(section, si) {
  const isOpen = openSections.has(si);
  const clausesHtml = (section.clauses || []).map((c, ci) => renderClause(c, si, ci)).join('');
  const count = (section.clauses || []).length;

  return `
    <div class="pb-section ${isOpen ? 'open' : ''}" data-section="${si}">
      <div class="pb-section-hdr" onclick="toggleSection(${si})">
        <span class="pb-section-chevron">${isOpen ? '▼' : '▶'}</span>
        <input class="pb-section-title-inp" value="${escHtml(section.title)}"
               data-section="${si}" data-field="title"
               onclick="event.stopPropagation()" placeholder="Section name">
        <div class="pb-section-meta" onclick="event.stopPropagation()">
          <span class="pb-section-count">${count} clause${count !== 1 ? 's' : ''}</span>
          <button class="pb-btn-sm" onclick="addClause(${si})">+ Clause</button>
          <button class="pb-btn-sm pb-btn-danger" onclick="deleteSection(${si})">Delete</button>
        </div>
      </div>
      <div class="pb-section-body" ${isOpen ? '' : 'style="display:none"'}>
        ${clausesHtml}
        ${count === 0 ? '<p class="pb-empty">No clauses yet — click "+ Clause" above.</p>' : ''}
      </div>
    </div>
  `;
}

function renderClausesTab() {
  document.getElementById('sections-container').innerHTML =
    (playbookData.sections || []).map((s, i) => renderSection(s, i)).join('');
  renderClauseSidebar();
}

// ── Clause selection & sidebar ────────────────────────────────────────────────

function selectClauseFromEl(event, si, ci) {
  if (event.target.matches('textarea,input,button,select,label')) return;
  selectClause(si, ci);
}

function selectClause(si, ci) {
  selectedClause = { si, ci };
  document.querySelectorAll('.pb-clause').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.pb-clause[data-section="${si}"][data-clause="${ci}"]`)?.classList.add('selected');
  renderClauseSidebar();
}

function renderClauseSidebar() {
  const sidebar = document.getElementById('clause-sidebar');
  if (!selectedClause) return;
  const { si, ci } = selectedClause;
  const section = playbookData.sections[si];
  const clause = section?.clauses[ci];
  if (!clause) return;

  const lib = clause.library || { contractClauses: [], emailTemplates: [], standardResponses: [] };
  const clauseLabel = `${section.title} — Clause ${ci + 1}`;

  sidebar.innerHTML = `
    <div class="pb-sidebar-clause-header">
      <div class="pb-sidebar-clause-label">Selected clause</div>
      <div class="pb-sidebar-clause-name">${escHtml(clauseLabel)}</div>
    </div>
    <div class="pb-sidebar-sections">
      ${sidebarSection('contracts', 'Pre-approved Clauses', lib.contractClauses, si, ci,
          [['name','Clause name'],['clauseText','Clause text']])}
      ${sidebarSection('templates', 'Email Templates', lib.emailTemplates, si, ci,
          [['scenario','Scenario'],['subject','Subject'],['body','Body']])}
      ${sidebarSection('responses', 'Standard Responses', lib.standardResponses, si, ci,
          [['ask','Counterparty ask'],['response','Our response']])}
    </div>
  `;
}

function sidebarSection(colorClass, title, items, si, ci, fields) {
  const typeKey = colorClass === 'contracts' ? 'contractClauses' : colorClass === 'templates' ? 'emailTemplates' : 'standardResponses';
  const itemsHtml = (items || []).map((item, idx) => `
    <div class="pb-sidebar-item">
      ${fields.map(([field, label]) => `
        <div class="pb-sidebar-item-field">
          <span class="pb-sidebar-item-label">${label}</span>
          <textarea class="pb-sidebar-item-ta" rows="${field === 'body' || field === 'clauseText' || field === 'response' ? 4 : 1}"
                    data-si="${si}" data-ci="${ci}" data-libkey="${typeKey}" data-item="${idx}" data-field="${field}">${escHtml(String(item[field] || ''))}</textarea>
        </div>
      `).join('')}
      <button class="pb-sidebar-item-remove" onclick="removeSidebarItem(${si},${ci},'${typeKey}',${idx})">Remove</button>
    </div>
  `).join('');

  const emptyHtml = items.length === 0 ? `<div class="pb-sidebar-empty-items">None yet.</div>` : '';

  return `
    <div class="pb-sidebar-section">
      <div class="pb-sidebar-section-header">
        <span class="pb-sidebar-section-title ${colorClass}">${title}</span>
        <button class="pb-btn-sm" onclick="addSidebarItem(${si},${ci},'${typeKey}')">+ Add</button>
      </div>
      <div class="pb-sidebar-items">${itemsHtml}${emptyHtml}</div>
    </div>
  `;
}

function addSidebarItem(si, ci, typeKey) {
  if (!playbookData.sections[si].clauses[ci].library) {
    playbookData.sections[si].clauses[ci].library = { contractClauses: [], emailTemplates: [], standardResponses: [] };
  }
  const defaults = {
    contractClauses:  { name: '', clauseText: '' },
    emailTemplates:   { scenario: '', subject: '', body: '' },
    standardResponses: { ask: '', response: '' },
  };
  playbookData.sections[si].clauses[ci].library[typeKey].push({ ...defaults[typeKey] });
  markDirty();
  renderClauseSidebar();
}

function removeSidebarItem(si, ci, typeKey, idx) {
  playbookData.sections[si].clauses[ci].library[typeKey].splice(idx, 1);
  markDirty();
  renderClauseSidebar();
}

// ── Decision Trees tab ────────────────────────────────────────────────────────

function renderTreesTab() {
  const trees = playbookData.decisionTrees || [];
  document.getElementById('trees-panel').innerHTML = `
    <div class="pb-trees-header">
      <p class="pb-trees-desc">Rules that help non-lawyers make decisions without guessing. Each rule set is a series of conditions that lead to an action.</p>
      <button class="pb-btn-sm" onclick="addDecisionTree()">+ Add rule set</button>
    </div>
    ${trees.length === 0 ? `
      <div class="pb-trees-empty">
        <div class="pb-trees-empty-examples">
          <div class="pb-example-rule">If contract value &gt; €50,000 → Legal review required before signing</div>
          <div class="pb-example-rule">If counterparty refuses mutual NDA → Escalate to legal + commercial lead</div>
          <div class="pb-example-rule">If unlimited liability clause present → Hard stop — raise Jira SD ticket</div>
        </div>
        <p class="pb-trees-empty-cta">Add your first rule set to get started.</p>
      </div>` : trees.map((tree, ti) => renderTreeCard(tree, ti)).join('')}
  `;
}

function renderTreeCard(tree, ti) {
  const rulesHtml = (tree.rules || []).map((rule, ri) => `
    <div class="pb-rule" data-tree="${ti}" data-rule="${ri}">
      <div class="pb-rule-fields">
        <div class="pb-rule-condition">
          <label class="pb-field-label">If</label>
          <input class="pb-rule-input" type="text" value="${escHtml(rule.condition)}" data-tree="${ti}" data-rule="${ri}" data-field="condition" placeholder="Condition…">
        </div>
        <svg class="pb-rule-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        <div class="pb-rule-action">
          <label class="pb-field-label">Then</label>
          <input class="pb-rule-input" type="text" value="${escHtml(rule.action)}" data-tree="${ti}" data-rule="${ri}" data-field="action" placeholder="Action to take…">
        </div>
      </div>
      <button class="pb-btn-icon" onclick="deleteRule(${ti}, ${ri})" title="Remove rule">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  return `
    <div class="pb-tree-card" data-tree="${ti}">
      <div class="pb-tree-header">
        <input class="pb-tree-name-input" type="text" value="${escHtml(tree.name)}" data-tree="${ti}" data-field="treeName" placeholder="Rule set name…">
        <div class="pb-tree-actions">
          <button class="pb-btn-sm" onclick="addRule(${ti})">+ Rule</button>
          <button class="pb-btn-sm pb-btn-danger" onclick="deleteTree(${ti})">Delete</button>
        </div>
      </div>
      <div class="pb-rules-list">
        ${rulesHtml}
        ${(tree.rules || []).length === 0 ? '<p class="pb-empty">No rules yet — add one above.</p>' : ''}
      </div>
    </div>
  `;
}

function addDecisionTree() {
  playbookData.decisionTrees.push({ id: Date.now().toString(), name: 'New rule set', rules: [] });
  markDirty();
  renderTreesTab();
}

function deleteTree(ti) {
  if (!confirm(`Delete rule set "${playbookData.decisionTrees[ti].name}"?`)) return;
  playbookData.decisionTrees.splice(ti, 1);
  markDirty();
  renderTreesTab();
}

function addRule(ti) {
  playbookData.decisionTrees[ti].rules.push({ condition: '', action: '' });
  markDirty();
  renderTreesTab();
}

function deleteRule(ti, ri) {
  playbookData.decisionTrees[ti].rules.splice(ri, 1);
  markDirty();
  renderTreesTab();
}

// ── Interactions (clauses) ────────────────────────────────────────────────────

function toggleSection(si) {
  if (openSections.has(si)) openSections.delete(si);
  else openSections.add(si);
  renderClausesTab();
}

function addClause(si) {
  playbookData.sections[si].clauses.push({
    issue: '',
    clauseExtract: '',
    complianceRationale: '',
    applicableLaw: [],
    escalationTriggers: [],
    checklist: [],
    fallbackPositions: ['', '', ''],
    generalNotes: '',
    nonPermissibleDilutions: [],
    library: { contractClauses: [], emailTemplates: [], standardResponses: [] }
  });
  openSections.add(si);
  markDirty();
  renderClausesTab();
  setTimeout(() => {
    const clauses = document.querySelectorAll(`.pb-section[data-section="${si}"] .pb-clause`);
    clauses[clauses.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    clauses[clauses.length - 1]?.querySelector('.pb-clause-issue-ta')?.focus();
  }, 50);
}

function deleteClause(si, ci) {
  if (!confirm('Remove this clause?')) return;
  playbookData.sections[si].clauses.splice(ci, 1);
  markDirty();
  renderClausesTab();
}

function deleteSection(si) {
  const title = playbookData.sections[si].title;
  if (!confirm(`Delete section "${title}" and all its clauses?`)) return;
  openSections.delete(si);
  playbookData.sections.splice(si, 1);
  markDirty();
  renderClausesTab();
}

function addSection() {
  playbookData.sections.push({ id: 'section-' + Date.now(), title: 'New Section', clauses: [] });
  const si = playbookData.sections.length - 1;
  openSections.add(si);
  markDirty();
  renderClausesTab();
  setTimeout(() => {
    const inp = document.querySelector(`.pb-section[data-section="${si}"] .pb-section-title-inp`);
    inp?.focus(); inp?.select();
  }, 50);
}

function addArrayItem(si, ci, field) {
  const clause = playbookData.sections[si].clauses[ci];
  if (!Array.isArray(clause[field])) clause[field] = [];
  clause[field].push('');
  markDirty();
  renderClausesTab();
}

function removeArrayItem(si, ci, field, idx) {
  playbookData.sections[si].clauses[ci][field].splice(idx, 1);
  markDirty();
  renderClausesTab();
}

// ── Change tracking ───────────────────────────────────────────────────────────

document.addEventListener('input', (e) => {
  const el = e.target;

  // Decision tree fields
  const ti = el.dataset.tree !== undefined ? parseInt(el.dataset.tree) : null;
  if (ti !== null && !isNaN(ti)) {
    const ri = el.dataset.rule !== undefined ? parseInt(el.dataset.rule) : null;
    const field = el.dataset.field;
    if (field === 'treeName') playbookData.decisionTrees[ti].name = el.value;
    else if (ri !== null && !isNaN(ri)) playbookData.decisionTrees[ti].rules[ri][field] = el.value;
    markDirty(); return;
  }

  // Per-clause sidebar library items
  if (el.dataset.libkey) {
    const si = parseInt(el.dataset.si);
    const ci = parseInt(el.dataset.ci);
    const idx = parseInt(el.dataset.item);
    const field = el.dataset.field;
    playbookData.sections[si].clauses[ci].library[el.dataset.libkey][idx][field] = el.value;
    markDirty(); return;
  }

  // Array fields (escalationTriggers, checklist, fallbackPositions, etc.)
  if (el.dataset.arrayfield) {
    const si = parseInt(el.dataset.section);
    const ci = parseInt(el.dataset.clause);
    const field = el.dataset.arrayfield;
    const idx = parseInt(el.dataset.item);
    const clause = playbookData.sections[si].clauses[ci];
    if (!Array.isArray(clause[field])) clause[field] = [];
    clause[field][idx] = el.value;
    markDirty(); return;
  }

  // Standard clause fields
  const si = el.dataset.section !== undefined ? parseInt(el.dataset.section) : null;
  const ci = el.dataset.clause !== undefined ? parseInt(el.dataset.clause) : null;
  const field = el.dataset.field;
  if (si === null || isNaN(si) || !field) return;
  if (ci === null || isNaN(ci)) playbookData.sections[si][field] = el.value;
  else playbookData.sections[si].clauses[ci][field] = el.value;
  markDirty();
});

// ── Save ──────────────────────────────────────────────────────────────────────

async function savePlaybook() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/playbook-data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(playbookData) });
    if (!r.ok) throw new Error(await r.text());
    markClean();
  } catch (e) {
    const el = document.getElementById('save-status');
    el.textContent = 'Save failed: ' + e.message;
    el.className = 'pb-save-status error';
  }
  btn.disabled = false; btn.textContent = 'Save changes';
}

window.addEventListener('beforeunload', e => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } });

// ── Boot ──────────────────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', savePlaybook);
document.getElementById('add-section-btn').addEventListener('click', addSection);
document.querySelectorAll('.pb-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function init() {
  try {
    const r = await fetch('/api/playbook-data');
    playbookData = await r.json();
    renderClausesTab();
    renderTreesTab();
  } catch (e) {
    document.getElementById('sections-container').innerHTML =
      `<div style="padding:40px;text-align:center;color:#ef4444">Failed to load playbook: ${e.message}</div>`;
  }
}

init();
