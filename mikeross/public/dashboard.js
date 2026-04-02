'use strict';

const dropZone    = document.getElementById('dash-drop-zone');
const fileInput   = document.getElementById('dash-file-input');
const progress    = document.getElementById('dash-upload-progress');
const docList     = document.getElementById('dash-doc-list');

// ─── Upload ───────────────────────────────────────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) handleUpload(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) handleUpload(fileInput.files[0]);
  fileInput.value = '';
});

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    alert('Please upload a .docx file.');
    return;
  }
  dropZone.style.pointerEvents = 'none';
  progress.classList.remove('hidden');
  try {
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch('/api/parse', { method: 'POST', body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Server error');
    }
    const data = await resp.json();
    // Cache parsed result so the doc page doesn't need to re-parse
    sessionStorage.setItem('docData_' + file.name, JSON.stringify(data));
    location.href = '/doc?name=' + encodeURIComponent(file.name);
  } catch (e) {
    alert('Failed to parse document: ' + e.message);
    dropZone.style.pointerEvents = '';
    progress.classList.add('hidden');
  }
}

// ─── Document list ────────────────────────────────────────────────────────

function shortName(name) {
  const base = name.split(/[/\\]/).pop();
  return base.length > 60 ? base.slice(0, 58) + '…' : base;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function severitySummary(issues) {
  const counts = { hard_stop: 0, negotiate: 0, acceptable: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  const pills = [];
  if (counts.hard_stop)  pills.push(`<span class="dash-sev-pill hard_stop">${counts.hard_stop} hard stop${counts.hard_stop > 1 ? 's' : ''}</span>`);
  if (counts.negotiate)  pills.push(`<span class="dash-sev-pill negotiate">${counts.negotiate} negotiate</span>`);
  if (counts.acceptable) pills.push(`<span class="dash-sev-pill acceptable">${counts.acceptable} ok</span>`);
  return pills.length ? `<span class="dash-sev-pills">${pills.join('')}</span>` : '';
}

async function loadDocs() {
  try {
    const r = await fetch('/api/reviews');
    const { documents } = await r.json();

    if (!documents.length) {
      docList.innerHTML = '<div class="dash-list-empty">No documents reviewed yet. Upload a .docx above to get started.</div>';
      return;
    }

    docList.innerHTML = documents.map(doc => {
      const latestRun   = doc.runs[0];
      const totalEvals  = doc.runs.reduce((n, r) => n + (r.evaluations?.length || 0), 0);
      const lastDate    = fmtDate(latestRun.createdAt);
      const sevHtml     = severitySummary(latestRun.issues);
      const evalsHtml   = totalEvals ? `<span class="dash-eval-chip">${totalEvals} eval${totalEvals > 1 ? 's' : ''}</span>` : '';
      const runsLabel   = `${doc.runs.length} run${doc.runs.length > 1 ? 's' : ''}`;

      return `
        <div class="dash-doc-row">
          <div class="dash-doc-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div class="dash-doc-info">
            <div class="dash-doc-name" title="${escHtml(doc.contractName)}">${escHtml(shortName(doc.contractName))}</div>
            <div class="dash-doc-meta">
              <span>Last reviewed ${lastDate}</span>
              <span class="dash-doc-meta-sep">·</span>
              <span>${runsLabel}</span>
              ${sevHtml ? `<span class="dash-doc-meta-sep">·</span>${sevHtml}` : ''}
              ${evalsHtml ? `<span class="dash-doc-meta-sep">·</span>${evalsHtml}` : ''}
            </div>
          </div>
          <div class="dash-doc-actions">
            <a class="dash-btn dash-btn-primary" href="/doc?name=${encodeURIComponent(doc.contractName)}">
              Open
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    docList.innerHTML = `<div class="dash-list-empty" style="color:#ef4444">Failed to load: ${e.message}</div>`;
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

loadDocs();
