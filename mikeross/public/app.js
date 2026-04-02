(() => {
  // ─── Elements ────────────────────────────────────────────────────────────────
  const uploadScreen   = document.getElementById("upload-screen");
  const mainContent    = document.getElementById("main-content");
  const dropZone       = document.getElementById("drop-zone");
  const fileInput      = document.getElementById("file-input");
  const documentPaper  = document.getElementById("document-paper");
  const loading        = document.getElementById("loading");
  const filenameEl     = document.getElementById("filename");
  const headerStats    = document.getElementById("header-stats");
  const uploadNewBtn   = document.getElementById("upload-new-btn");
  const sidebarPanel   = document.getElementById("sidebar-panel");
  const jsonView       = document.getElementById("json-view");
  const jsonPre        = document.getElementById("json-pre");
  const jsonCopyBtn    = document.getElementById("json-copy-btn");
  const vtDoc          = document.getElementById("vt-doc");
  const vtJson         = document.getElementById("vt-json");

  const reviewBadge    = document.getElementById("review-badge");
  const statIns        = document.getElementById("stat-ins");
  const statDel        = document.getElementById("stat-del");
  const statCom        = document.getElementById("stat-com");

  // ─── Local annotation state ───────────────────────────────────────────────
  let localIdSeq = 0;
  const localData = { insertions: [], deletions: [], comments: [] };

  // ─── SVG connector lines ──────────────────────────────────────────────────
  const connectorSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connectorSvg.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:visible;";
  document.body.appendChild(connectorSvg);

  function clearConnectors() {
    while (connectorSvg.firstChild) connectorSvg.removeChild(connectorSvg.firstChild);
  }

  let _scrollEndTimer = null;
  let _pendingRedraw = null;

  function redrawOnScrollEnd(fn) {
    _pendingRedraw = fn;
    const onScroll = () => {
      clearTimeout(_scrollEndTimer);
      _scrollEndTimer = setTimeout(done, 80);
    };
    const done = () => {
      window.removeEventListener("scroll", onScroll, true);
      clearTimeout(_scrollEndTimer);
      if (_pendingRedraw) { _pendingRedraw(); _pendingRedraw = null; }
    };
    window.addEventListener("scroll", onScroll, true);
    // Fallback: if already in view and no scroll fires, redraw after short delay
    _scrollEndTimer = setTimeout(done, 150);
  }

  function drawConnectors(cardEl, spanEls, color) {
    clearConnectors();
    if (!spanEls.length) return;
    const cardRect = cardEl.getBoundingClientRect();
    const x1 = cardRect.left;
    const y1 = cardRect.top + cardRect.height / 2;
    for (const span of spanEls) {
      const spanRect = span.getBoundingClientRect();
      if (spanRect.width === 0 && spanRect.height === 0) continue;
      const x2 = spanRect.right;
      const y2 = spanRect.top + spanRect.height / 2;
      const mx = (x1 + x2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x2} ${y2} C ${mx} ${y2}, ${mx} ${y1}, ${x1} ${y1}`);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-dasharray", "4 3");
      path.setAttribute("fill", "none");
      path.setAttribute("opacity", "0.55");
      connectorSvg.appendChild(path);
    }
  }

  // ─── Upload ──────────────────────────────────────────────────────────────────
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
    fileInput.value = "";
  });
  uploadNewBtn.addEventListener("click", () => {
    mainContent.classList.add("hidden");
    jsonView.classList.add("hidden");
    uploadScreen.classList.remove("hidden");
    headerStats.style.display = "none";
    if (downloadDocxBtn) downloadDocxBtn.style.display = "none";
    filenameEl.classList.add("hidden");
    documentPaper.innerHTML = "";
    localData.insertions = [];
    localData.deletions  = [];
    localData.comments   = [];
    hideToolbar();
    setView("doc");
  });

  // ─── View toggle ──────────────────────────────────────────────────────────
  function setView(v) {
    vtDoc.classList.toggle("active", v === "doc");
    vtJson.classList.toggle("active", v === "json");
    mainContent.classList.toggle("hidden", v !== "doc");
    jsonView.classList.toggle("hidden", v !== "json");
    if (v === "json") renderJson();
  }

  vtDoc.addEventListener("click",  () => setView("doc"));
  vtJson.addEventListener("click", () => setView("json"));

  function renderJson() {
    const allIns = [...(parsedDoc?.insertions ?? []), ...localData.insertions];
    const allDel = [...(parsedDoc?.deletions  ?? []), ...localData.deletions];
    const allCom = [...(parsedDoc?.comments   ?? []), ...localData.comments].filter((c) => c.text);

    const output = {
      insertions: allIns.map((r) => ({
        text:   r.text,
        author: r.author || "You",
        date:   r.date   || null,
        id:     r.revisionId || null,
      })),
      deletions: allDel.map((r) => ({
        text:   r.text,
        author: r.author || "You",
        date:   r.date   || null,
        id:     r.revisionId || null,
      })),
      comments: allCom.map((c) => ({
        id:     c.id,
        author: c.author,
        date:   c.date || null,
        text:   c.text,
      })),
    };

    jsonPre.textContent = JSON.stringify(output, null, 2);
  }

  jsonCopyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(jsonPre.textContent).then(() => {
      jsonCopyBtn.textContent = "Copied!";
      setTimeout(() => { jsonCopyBtn.textContent = "Copy"; }, 1500);
    });
  });


  // ─── File handling ────────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("Please upload a .docx file.");
      return;
    }
    loading.classList.remove("hidden");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/parse", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Server error");
      }
      const data = await resp.json();
      renderApp(file.name, data);
    } catch (e) {
      alert("Failed to parse document: " + e.message);
    } finally {
      loading.classList.add("hidden");
    }
  }

  // ─── Render app ───────────────────────────────────────────────────────────
  let parsedDoc = null;
  let playbookSections = {};
  let currentRunId = null;
  let currentRunIssues = [];
  let docHistory = null; // array of runs from server for current doc
  let viewingRunId = 'current'; // which run is currently shown in the playbook panel

  let currentStepRunId = null;
  let currentStepData = null;   // { sections, anomalousClauses }
  let stepDocHistory = null;
  let stepEvalGrades = {};      // { "sectionIdx:clauseIdx": { verdict, comment } }

  function renderApp(filename, data) {
    parsedDoc = data;
    localData.insertions = [];
    localData.deletions  = [];
    localData.comments   = [];
    currentRunId     = null;
    currentRunIssues = [];
    docHistory       = null;
    playbookSections = {};
    playbookPanel.innerHTML = "";
    playbookBadge.textContent = "0";
    playbookBadge.classList.add("badge-hidden");
    currentStepRunId = null;
    currentStepData  = null;
    stepDocHistory   = null;
    stepEvalGrades   = {};
    stepReviewPanel.innerHTML = "";
    stepReviewBadge.textContent = "0";
    stepReviewBadge.classList.add("badge-hidden");

    filenameEl.textContent = filename;
    filenameEl.classList.remove("hidden");
    headerStats.style.display = "flex";
    if (downloadDocxBtn) downloadDocxBtn.style.display = "";
    setView("doc");

    updateStats();
    renderDocument(data.paragraphs);
    renderSidebar();

    uploadScreen.classList.add("hidden");
    mainContent.classList.remove("hidden");
    document.getElementById("eval-header-group").style.display = "flex";

    // Load history for this document
    loadDocHistory(filename);
    loadStepDocHistory(filename);
  }

  async function loadDocHistory(contractName) {
    try {
      const r = await fetch('/api/reviews');
      const { documents } = await r.json();
      const doc = documents.find(d => d.contractName === contractName);
      docHistory = doc ? doc.runs : [];
      // Auto-populate Playbook tab with latest run if no current session
      if (docHistory.length && !currentRunId && evalMode) {
        renderPlaybookIssues(docHistory[0].issues, docHistory[0].id, docHistory[0].evaluations || []);
      } else if (currentRunId) {
        renderPlaybookIssues(currentRunIssues, 'current', []);
      }
    } catch { docHistory = []; }
  }

  async function loadStepDocHistory(contractName) {
    try {
      const r = await fetch('/api/step-reviews');
      const { documents } = await r.json();
      const doc = documents.find(d => d.contractName === contractName);
      stepDocHistory = doc ? doc.runs : [];
      if (stepDocHistory.length && !currentStepRunId && evalMode) {
        const run = stepDocHistory[0];
        renderStepReview({ sections: run.sections, anomalousClauses: run.anomalousClauses }, run.id, run.evaluations || []);
      } else if (currentStepRunId && currentStepData) {
        renderStepReview(currentStepData, 'current', []);
      }
    } catch { stepDocHistory = []; }
  }

  function renderHistoryBar(activeRunId) {
    if (!evalMode) return '';
    const runs = docHistory || [];
    const hasSession = !!currentRunId;
    if (!hasSession && !runs.length) return '';

    let options = '';
    if (hasSession) {
      const n = currentRunIssues.length;
      options += `<option value="current"${activeRunId === 'current' ? ' selected' : ''}>Current session · ${n} issue${n !== 1 ? 's' : ''}</option>`;
    }
    for (const run of runs) {
      if (run.id === currentRunId) continue; // already shown as "Current session"
      const d = new Date(run.createdAt);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const evCount = run.evaluations?.length || 0;
      const n = run.issues.length;
      const label = `${dateStr} · ${n} issue${n !== 1 ? 's' : ''}${evCount ? ` · ${evCount} eval${evCount > 1 ? 's' : ''}` : ''}`;
      options += `<option value="${escapeHtml(run.id)}"${activeRunId === run.id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }
    if (!options) return '';

    return `<div class="pb-history-bar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <select class="pb-history-select" id="pb-history-select">${options}</select>
    </div>`;
  }

  function updateStats() {
    if (!parsedDoc) return;
    const insCount = groupRunsByRevisionId([...parsedDoc.insertions, ...localData.insertions]).length;
    const delCount = groupRunsByRevisionId([...parsedDoc.deletions,  ...localData.deletions]).length;
    const allComments = [...parsedDoc.comments, ...localData.comments].filter((c) => c.text);
    const comCount = allComments.filter((c) => !c.parentId).length;

    statIns.textContent = `+${insCount} insertion${insCount !== 1 ? "s" : ""}`;
    statDel.textContent = `-${delCount} deletion${delCount !== 1 ? "s" : ""}`;
    statCom.textContent = `${comCount} comment${comCount !== 1 ? "s" : ""}`;
    reviewBadge.textContent = insCount + delCount + comCount;
  }

  // ─── Playbook section helpers ──────────────────────────────────────────────
  const PLAYBOOK_SECTION_HEADINGS = [
    'Preamble', 'Purpose', 'Definition of Affiliates', 'Definition of Business Day',
    'Definition of Confidential Information', 'Exclusions',
    'Use and Disclosure of Confidential Information', 'Receiving Party Personnel Affiliates',
    'Disclosures to Governmental Entities', 'Ownership of Confidential Information',
    'Notice of Unauthorised Use', 'Return of Confidential Information',
    'Injunctive Relief', 'Penalties', 'Scope, Term, and Termination', 'Warranties', 'Miscellaneous'
  ];

  function parsePlaybookSections(text) {
    const lines = text.split('\n');
    const sections = {};
    let current = null;
    let buf = [];
    for (const line of lines) {
      const t = line.trim();
      if (PLAYBOOK_SECTION_HEADINGS.includes(t)) {
        if (current) sections[current] = buf.join('\n').trim();
        current = t;
        buf = [];
      } else if (current) {
        buf.push(line);
      }
    }
    if (current) sections[current] = buf.join('\n').trim();
    return sections;
  }

  function formatPlaybookSectionHtml(text) {
    const lines = text.split('\n');
    let html = '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t === 'Negotiation Points') {
        html += `<div class="pb-subheading">Negotiation Points</div>`;
      } else if (t.startsWith('exclamation mark')) {
        const content = t.replace(/^exclamation mark/, '').replace(/^Issue\s*\d*:?\s*/i, '');
        html += `<div class="pb-issue"><div class="pb-tag">Issue</div>${escapeHtml(content)}</div>`;
      } else if (t.startsWith('megaphone')) {
        const content = t.replace(/^megaphoneTalking Point:\s*/i, '');
        html += `<div class="pb-talking"><div class="pb-tag">Talking Point</div>${escapeHtml(content)}</div>`;
      } else if (t.startsWith('fire')) {
        const content = t.replace(/^fire\s*Fallback Option:\s*/i, '');
        html += `<div class="pb-fallback"><div class="pb-tag">Fallback</div>${escapeHtml(content)}</div>`;
      } else if (t.startsWith('star')) {
        const content = t.replace(/^star/, '');
        html += `<div class="pb-bullet">• ${escapeHtml(content)}</div>`;
      } else {
        html += `<p>${escapeHtml(t)}</p>`;
      }
    }
    return html;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function styleClass(style) {
    if (!style) return "";
    const s = style.toLowerCase();
    if (s.includes("heading1") || s === "1") return "heading1";
    if (s.includes("heading2") || s === "2") return "heading2";
    if (s.includes("heading3") || s === "3") return "heading3";
    return "";
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch { return dateStr; }
  }

  // Group consecutive runs sharing the same revisionId into one logical change
  function groupRunsByRevisionId(runs) {
    if (!runs.length) return [];
    const out = [];
    for (const run of runs) {
      const prev = out[out.length - 1];
      if (prev && prev.revisionId && prev.revisionId === run.revisionId) {
        prev.text += run.text;
      } else {
        out.push({ ...run });
      }
    }
    return out;
  }

  // Merge adjacent runs that share the same type and commentIds into one span
  function mergeAdjacentRuns(runs) {
    if (!runs.length) return runs;
    const out = [{ ...runs[0], text: runs[0].text }];
    for (let i = 1; i < runs.length; i++) {
      const prev = out[out.length - 1];
      const cur  = runs[i];
      const sameCids = (prev.commentIds ?? []).join(",") === (cur.commentIds ?? []).join(",");
      if (prev.type === cur.type && sameCids && prev.revisionId === cur.revisionId) {
        prev.text += cur.text;
      } else {
        out.push({ ...cur, text: cur.text });
      }
    }
    return out;
  }

  // ─── Document render ─────────────────────────────────────────────────────
  function renderDocument(paragraphs) {
    let html = "";
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const cls = styleClass(para.style);
      const runs = mergeAdjacentRuns(para.runs);
      const isEmpty = runs.length === 0 || runs.every((r) => !r.text.trim());
      const paraClass = ["doc-para", cls, isEmpty ? "empty" : ""].filter(Boolean).join(" ");

      let inner = "";
      for (const run of runs) {
        const text  = escapeHtml(run.text);
        const revId = escapeHtml(run.revisionId ?? "");
        const cids  = run.commentIds?.length ? escapeHtml(run.commentIds.join(",")) : "";

        if (run.type === "insertion") {
          inner += `<span class="run-insertion${cids ? " run-comment" : ""}" data-rev="ins-${revId}"${cids ? ` data-cids="${cids}"` : ""}>${text}</span>`;
        } else if (run.type === "deletion") {
          inner += `<span class="run-deletion${cids ? " run-comment" : ""}" data-rev="del-${revId}"${cids ? ` data-cids="${cids}"` : ""}>${text}</span>`;
        } else {
          inner += cids
            ? `<span class="run-comment" data-cids="${cids}">${text}</span>`
            : `<span>${text}</span>`;
        }
      }

      html += `<p class="${paraClass}" data-para-idx="${i}">${inner || "\u00a0"}</p>`;
    }
    documentPaper.innerHTML = html;
    attachDocHoverHandlers();
  }

  // ─── Unified sidebar ──────────────────────────────────────────────────────
  function renderSidebar() {
    const allComments = [...(parsedDoc?.comments ?? []), ...localData.comments].filter((c) => c.text);
    const commentMap  = new Map(allComments.map((c) => [c.id, c]));

    // Build thread map: paraId -> reply comments
    const threadMap = new Map();
    for (const c of allComments) {
      if (c.parentId) {
        if (!threadMap.has(c.parentId)) threadMap.set(c.parentId, []);
        threadMap.get(c.parentId).push(c);
      }
    }

    // Build grouped run maps keyed by revisionId
    const allIns = [...(parsedDoc?.insertions ?? []), ...localData.insertions];
    const allDel = [...(parsedDoc?.deletions  ?? []), ...localData.deletions];
    const insMap = new Map();
    const delMap = new Map();
    for (const run of groupRunsByRevisionId(allIns)) insMap.set(run.revisionId, run);
    for (const run of groupRunsByRevisionId(allDel)) delMap.set(run.revisionId, run);

    // Walk paragraphs to build document-ordered item list
    const seenRevIds     = new Set();
    const seenCommentIds = new Set();
    const orderedItems   = [];

    if (parsedDoc) {
      for (const para of parsedDoc.paragraphs) {
        for (const run of para.runs) {
          if ((run.type === "insertion" || run.type === "deletion") && run.revisionId) {
            const t   = run.type === "insertion" ? "ins" : "del";
            const key = `${t}-${run.revisionId}`;
            if (!seenRevIds.has(key)) {
              seenRevIds.add(key);
              const grouped = t === "ins" ? insMap.get(run.revisionId) : delMap.get(run.revisionId);
              if (grouped) orderedItems.push({ type: t, data: grouped });
            }
          }
          if (run.commentIds && run.commentIds.length > 0) {
            const freshCids = run.commentIds.filter(cid => !seenCommentIds.has(cid));
            if (freshCids.length > 0) {
              for (const cid of freshCids) seenCommentIds.add(cid);
              // All root comments sharing this anchor → one thread bubble, sorted by date
              const anchorComments = freshCids
                .map(cid => commentMap.get(cid))
                .filter(c => c && !c.parentId)
                .sort((a, b) => new Date(a.date) - new Date(b.date));
              if (anchorComments.length > 0) {
                orderedItems.push({ type: "comment", data: anchorComments[0], anchorReplies: anchorComments.slice(1) });
              }
            }
          }
        }
      }
    }

    // Append local annotations (no paragraph order available)
    for (const run of groupRunsByRevisionId(localData.insertions)) orderedItems.push({ type: "ins", data: run });
    for (const run of groupRunsByRevisionId(localData.deletions))  orderedItems.push({ type: "del", data: run });
    for (const c of localData.comments.filter((c) => c.text))      orderedItems.push({ type: "comment", data: c });

    if (orderedItems.length === 0) {
      sidebarPanel.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p>No changes or comments.<br>Select text to annotate.</p>
        </div>`;
      return;
    }

    let html = "";
    for (const item of orderedItems) {
      if (item.type === "ins" || item.type === "del") {
        html += changeRowHtml(item.type, item.data);
      } else {
        const wordReplies   = threadMap.get(item.data.paraId) ?? [];
        const anchorReplies = item.anchorReplies ?? [];
        const allReplies    = [...anchorReplies, ...wordReplies]
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        html += commentThreadHtml(item.data, allReplies);
      }
    }

    sidebarPanel.innerHTML = html;
    attachChangesHoverHandlers();
    attachCommentHoverHandlers();
  }

  function changeRowHtml(type, run) {
    const revId  = escapeHtml(run.revisionId ?? "");
    const symbol = type === "ins" ? "+" : "−";
    const author = escapeHtml(run.author || "You");
    const date   = run.date ? escapeHtml(formatDate(run.date)) : "";
    const meta   = date ? `${author} · ${date}` : author;
    return `
      <div class="change-row ${type}" data-rev="${type}-${revId}">
        <span class="change-row-symbol">${symbol}</span>
        <div class="change-row-body">
          <span class="change-row-text">${escapeHtml(run.text)}</span>
          <span class="change-row-meta">${meta}</span>
        </div>
      </div>`;
  }

  function commentThreadHtml(rootComment, replies) {
    const thread  = [rootComment, ...replies.slice().sort((a, b) => new Date(a.date) - new Date(b.date))];
    const entries = thread.map((c, i) => `
      <div class="comment-entry${i > 0 ? " reply" : ""}">
        <div class="bubble-header">
          <span class="bubble-author">${escapeHtml(c.author)}</span>${c.date ? `<span class="bubble-date"> · ${escapeHtml(formatDate(c.date))}</span>` : ""}
        </div>
        <div class="bubble-text">${escapeHtml(c.text)}</div>
      </div>`).join('<div class="thread-divider"></div>');
    return `
      <div class="comment-bubble" data-comment-id="${escapeHtml(rootComment.id)}">
        ${entries}
      </div>`;
  }

  // ─── Hover: changes ──────────────────────────────────────────────────────
  function attachChangesHoverHandlers() {
    sidebarPanel.querySelectorAll(".change-row[data-rev]").forEach((row) => {
      const rev = row.dataset.rev;
      if (!rev) return;
      const docSpans = () => documentPaper.querySelectorAll(`[data-rev="${CSS.escape(rev)}"]`);

      row.addEventListener("mouseenter", () => {
        row.classList.add("highlighted");
        docSpans().forEach((el) => el.classList.add("highlighted"));
        drawConnectors(row, [...docSpans()], row.classList.contains("ins") ? "#22c55e" : "#ef4444");
      });
      row.addEventListener("mouseleave", () => {
        row.classList.remove("highlighted");
        docSpans().forEach((el) => el.classList.remove("highlighted"));
        clearConnectors();
      });
      row.addEventListener("click", () => {
        const first = docSpans()[0];
        if (!first) return;
        clearConnectors();
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        redrawOnScrollEnd(() => {
          drawConnectors(row, [...docSpans()], row.classList.contains("ins") ? "#22c55e" : "#ef4444");
        });
      });
    });
  }

  // ─── Hover: comments ─────────────────────────────────────────────────────
  function attachCommentHoverHandlers() {
    sidebarPanel.querySelectorAll(".comment-bubble[data-comment-id]").forEach((bubble) => {
      const cid = bubble.dataset.commentId;
      if (!cid) return;
      const anchoredSpans = () =>
        [...documentPaper.querySelectorAll("[data-cids]")].filter((el) =>
          el.dataset.cids.split(",").includes(cid)
        );

      bubble.addEventListener("mouseenter", () => {
        bubble.classList.add("highlighted");
        anchoredSpans().forEach((el) => el.classList.add("comment-highlighted"));
        drawConnectors(bubble, anchoredSpans(), "#f59e0b");
      });
      bubble.addEventListener("mouseleave", () => {
        bubble.classList.remove("highlighted");
        anchoredSpans().forEach((el) => el.classList.remove("comment-highlighted"));
        clearConnectors();
      });
      bubble.addEventListener("click", () => {
        const first = anchoredSpans()[0];
        if (!first) return;
        clearConnectors();
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        redrawOnScrollEnd(() => {
          drawConnectors(bubble, anchoredSpans(), "#f59e0b");
        });
      });
    });
  }

  // ─── Hover + click: doc → sidebar ───────────────────────────────────────
  function attachDocHoverHandlers() {
    documentPaper.addEventListener("mouseover", (e) => {
      const span = e.target.closest("[data-rev]");
      if (!span) return;
      sidebarPanel.querySelectorAll(`[data-rev="${CSS.escape(span.dataset.rev)}"]`).forEach((c) => c.classList.add("highlighted"));
    });
    documentPaper.addEventListener("mouseout", (e) => {
      const span = e.target.closest("[data-rev]");
      if (!span) return;
      sidebarPanel.querySelectorAll(`[data-rev="${CSS.escape(span.dataset.rev)}"]`).forEach((c) => c.classList.remove("highlighted"));
    });

    documentPaper.addEventListener("click", (e) => {
      // Clicks on annotation spans open the relevant sidebar card
      const span = e.target.closest("[data-rev], [data-cids]");
      if (!span) return;

      // If the click resulted in a selection (user is selecting text), don't navigate
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;

      if (span.dataset.rev) {
        const card = sidebarPanel.querySelector(`[data-rev="${CSS.escape(span.dataset.rev)}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
          card.classList.add("highlighted");
          setTimeout(() => card.classList.remove("highlighted"), 1500);
        }
      } else if (span.dataset.cids) {
        const firstCid = span.dataset.cids.split(",")[0];
        const card = sidebarPanel.querySelector(`[data-comment-id="${CSS.escape(firstCid)}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
          card.classList.add("highlighted");
          setTimeout(() => card.classList.remove("highlighted"), 1500);
        }
      }
    });
  }

  // ─── Download button ──────────────────────────────────────────────────────
  const downloadDocxBtn = document.getElementById("download-docx-btn");

  // ─── Paragraph position helper ────────────────────────────────────────────
  // Returns the paragraph index (data-para-idx) and char offsets of savedRange.
  // Must be called BEFORE wrapSavedRange() mutates the DOM.
  function getParaInfo(range) {
    let node = range.startContainer;
    while (node && !(node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("doc-para"))) {
      node = node.parentNode;
    }
    if (!node) return null;
    const paraIdx = parseInt(node.dataset.paraIdx, 10);
    if (isNaN(paraIdx)) return null;

    // Only handle single-paragraph selections
    let endNode = range.endContainer;
    while (endNode && !(endNode.nodeType === Node.ELEMENT_NODE && endNode.classList?.contains("doc-para"))) {
      endNode = endNode.parentNode;
    }
    if (endNode !== node) return null;

    // Walk text nodes from paragraph start to selection start to get charStart
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let charStart = 0;
    let found = false;
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      if (tn === range.startContainer) {
        charStart += range.startOffset;
        found = true;
        break;
      }
      charStart += tn.textContent.length;
    }
    if (!found) return null;
    return { paraIdx, charStart, charEnd: charStart + range.toString().length };
  }

  // ─── Floating annotation toolbar ─────────────────────────────────────────
  const toolbar = document.getElementById("ann-toolbar");
  const tbSuggest = document.getElementById("tb-suggest");
  const tbDelete  = document.getElementById("tb-delete");
  const tbComment = document.getElementById("tb-comment");
  const commentPopover  = document.getElementById("ann-popover");
  const commentTextarea = document.getElementById("ann-comment-text");
  const commentCancel   = document.getElementById("ann-cancel");
  const commentSubmit   = document.getElementById("ann-submit");

  let savedRange = null;

  function showToolbar(range) {
    const rect = range.getBoundingClientRect();
    toolbar.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    toolbar.style.top  = `${rect.top  + window.scrollY - 44}px`;
    toolbar.classList.remove("hidden");
  }

  function hideToolbar() {
    toolbar.classList.add("hidden");
    commentPopover.classList.add("hidden");
    savedRange = null;
  }

  // Show toolbar on text selection within the document paper
  document.addEventListener("mouseup", (e) => {
    if (toolbar.contains(e.target) || commentPopover.contains(e.target)) return;
    if (document.getElementById("missed-popover")?.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      if (!documentPaper.contains(range.commonAncestorContainer)) { hideToolbar(); return; }
      savedRange = range.cloneRange();
      showToolbar(range);
    }, 0);
  });

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideToolbar(); });

  // Wrap the saved range in a span and return that span
  function wrapSavedRange(className, attrs = {}) {
    if (!savedRange) return null;
    const span = document.createElement("span");
    span.className = className;
    for (const [k, v] of Object.entries(attrs)) span.dataset[k] = v;
    try {
      const frag = savedRange.extractContents();
      span.appendChild(frag);
      savedRange.insertNode(span);
      return span;
    } catch { return null; }
  }

  // ─── Suggest (insertion) ─────────────────────────────────────────────────
  tbSuggest.addEventListener("click", () => {
    const id = `local-${++localIdSeq}`;
    const pos = savedRange ? getParaInfo(savedRange) : null;
    const span = wrapSavedRange("run-insertion", { rev: id });
    if (!span) { hideToolbar(); return; }
    const text = span.textContent || "";
    const run = { text, type: "insertion", revisionId: id, author: "You", date: new Date().toISOString(),
      paraIndex: pos?.paraIdx ?? null, charStart: pos?.charStart ?? null, charEnd: pos?.charEnd ?? null };
    localData.insertions.push(run);
    updateStats();
    renderSidebar();
    setTimeout(() => {
      sidebarPanel.querySelector(`[data-rev="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    hideToolbar();
  });

  // ─── Delete (deletion mark) ───────────────────────────────────────────────
  tbDelete.addEventListener("click", () => {
    const id = `local-${++localIdSeq}`;
    const pos = savedRange ? getParaInfo(savedRange) : null;
    const span = wrapSavedRange("run-deletion", { rev: id });
    if (!span) { hideToolbar(); return; }
    const text = span.textContent || "";
    const run = { text, type: "deletion", revisionId: id, author: "You", date: new Date().toISOString(),
      paraIndex: pos?.paraIdx ?? null, charStart: pos?.charStart ?? null, charEnd: pos?.charEnd ?? null };
    localData.deletions.push(run);
    updateStats();
    renderSidebar();
    setTimeout(() => {
      sidebarPanel.querySelector(`[data-rev="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    hideToolbar();
  });

  // ─── Comment ──────────────────────────────────────────────────────────────
  tbComment.addEventListener("click", () => {
    toolbar.classList.add("hidden");
    // Position popover near selection
    if (savedRange) {
      const rect = savedRange.getBoundingClientRect();
      commentPopover.style.left = `${rect.left + window.scrollX}px`;
      commentPopover.style.top  = `${rect.bottom + window.scrollY + 8}px`;
    }
    commentPopover.classList.remove("hidden");
    commentTextarea.value = "";
    commentTextarea.focus();
  });

  commentCancel.addEventListener("click", hideToolbar);

  commentSubmit.addEventListener("click", () => {
    const text = commentTextarea.value.trim();
    if (!text) return;
    const id = `local-${++localIdSeq}`;
    const pos = savedRange ? getParaInfo(savedRange) : null;
    const span = wrapSavedRange("run-comment", { cids: id });
    if (!span) { hideToolbar(); return; }
    const comment = { id, author: "You", date: new Date().toISOString(), text,
      paraIndex: pos?.paraIdx ?? null, charStart: pos?.charStart ?? null, charEnd: pos?.charEnd ?? null };
    localData.comments.push(comment);
    updateStats();
    renderSidebar();
    setTimeout(() => {
      sidebarPanel.querySelector(`[data-comment-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    hideToolbar();
  });

  commentTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commentSubmit.click();
    if (e.key === "Escape") hideToolbar();
  });

  // ─── Download .docx ───────────────────────────────────────────────────────
  if (downloadDocxBtn) {
    downloadDocxBtn.addEventListener("click", async () => {
      const filename = filenameEl.textContent?.trim();
      if (!filename) return;

      const toExportItem = (r) => ({
        text:       r.text,
        id:         r.revisionId ?? r.id,
        author:     r.author ?? "You",
        date:       r.date   ?? new Date().toISOString(),
        paraIndex:  r.paraIndex  ?? null,
        charStart:  r.charStart  ?? null,
        charEnd:    r.charEnd    ?? null,
      });

      const payload = {
        filename,
        annotations: {
          insertions: localData.insertions.map(toExportItem),
          deletions:  localData.deletions.map(toExportItem),
          comments:   localData.comments.map((c) => ({
            ...toExportItem(c),
            id:   c.id,
            text: c.text,
          })),
        },
      };

      const origLabel = downloadDocxBtn.innerHTML;
      downloadDocxBtn.textContent = "Exporting…";
      downloadDocxBtn.disabled = true;

      try {
        const resp = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Export failed" }));
          throw new Error(err.error || "Export failed");
        }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = filename.replace(/\.docx$/i, "_annotated.docx");
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert("Export failed: " + e.message);
      } finally {
        downloadDocxBtn.innerHTML  = origLabel;
        downloadDocxBtn.disabled = false;
      }
    });
  }

  // ─── Sidebar tabs ────────────────────────────────────────────────────────
  const tabReview       = document.getElementById("tab-review");
  const tabPlaybook     = document.getElementById("tab-playbook");
  const tabStepReview   = document.getElementById("tab-step-review");
  const playbookPanel   = document.getElementById("playbook-panel");
  const playbookBadge   = document.getElementById("playbook-badge");
  const stepReviewPanel = document.getElementById("step-review-panel");
  const stepReviewBadge = document.getElementById("step-review-badge");

  // ─── Playbook anchors ─────────────────────────────────────────────────────
  function markPlaybookAnchors(issues) {
    // Remove existing anchors
    documentPaper.querySelectorAll(".playbook-anchor").forEach(el => {
      el.replaceWith(document.createTextNode(el.textContent));
    });

    issues.forEach((issue, idx) => {
      if (!issue.counterpartyText) return;
      const query = issue.counterpartyText.trim().slice(0, 60);
      if (!query) return;
      const walker = document.createTreeWalker(documentPaper, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const pos = node.textContent.indexOf(query);
        if (pos === -1) continue;
        const before = node.textContent.slice(0, pos);
        const after  = node.textContent.slice(pos + query.length);
        const span = document.createElement("span");
        span.className = "playbook-anchor";
        span.dataset.playbook = String(idx);
        span.textContent = query;
        const parent = node.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after)  parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);
        break;
      }
    });
  }

  function attachPlaybookHoverHandlers() {
    playbookPanel.querySelectorAll(".playbook-issue").forEach((card, i) => {
      const anchors = () => [...documentPaper.querySelectorAll(`.playbook-anchor[data-playbook="${i}"]`)];

      card.addEventListener("mouseenter", () => {
        card.classList.add("highlighted");
        anchors().forEach(a => a.classList.add("highlighted"));
        drawConnectors(card, anchors(), "#6366f1");
      });
      card.addEventListener("mouseleave", () => {
        card.classList.remove("highlighted");
        anchors().forEach(a => a.classList.remove("highlighted"));
        clearConnectors();
      });
      card.addEventListener("click", () => {
        const opening = !card.classList.contains("open");
        card.classList.toggle("open");
        if (opening) {
          const first = anchors()[0];
          if (first) {
            clearConnectors();
            first.scrollIntoView({ behavior: "smooth", block: "center" });
            redrawOnScrollEnd(() => drawConnectors(card, anchors(), "#6366f1"));
          }
        }
      });
    });

    // Doc anchor → sidebar hover
    documentPaper.addEventListener("mouseover", (e) => {
      const a = e.target.closest(".playbook-anchor[data-playbook]");
      if (!a) return;
      playbookPanel.querySelector(`.playbook-issue[data-playbook="${a.dataset.playbook}"]`)?.classList.add("highlighted");
    });
    documentPaper.addEventListener("mouseout", (e) => {
      const a = e.target.closest(".playbook-anchor[data-playbook]");
      if (!a) return;
      playbookPanel.querySelector(`.playbook-issue[data-playbook="${a.dataset.playbook}"]`)?.classList.remove("highlighted");
    });
    documentPaper.addEventListener("click", (e) => {
      if (e.target.closest(".step-anchor")) return; // step anchor takes priority
      const a = e.target.closest(".playbook-anchor[data-playbook]");
      if (!a) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      // Switch to Playbook tab and open the card
      tabPlaybook.click();
      const card = playbookPanel.querySelector(`.playbook-issue[data-playbook="${a.dataset.playbook}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (!card.classList.contains("open")) card.classList.add("open");
        card.classList.add("highlighted");
        setTimeout(() => card.classList.remove("highlighted"), 1500);
      }
    });
  }

  tabReview.addEventListener("click", () => {
    tabReview.classList.add("active");
    tabPlaybook.classList.remove("active");
    tabStepReview.classList.remove("active");
    sidebarPanel.classList.remove("hidden");
    playbookPanel.classList.add("hidden");
    stepReviewPanel.classList.add("hidden");
  });
  tabPlaybook.addEventListener("click", () => {
    tabPlaybook.classList.add("active");
    tabReview.classList.remove("active");
    tabStepReview.classList.remove("active");
    playbookPanel.classList.remove("hidden");
    sidebarPanel.classList.add("hidden");
    stepReviewPanel.classList.add("hidden");
  });
  tabStepReview.addEventListener("click", () => {
    tabStepReview.classList.add("active");
    tabReview.classList.remove("active");
    tabPlaybook.classList.remove("active");
    stepReviewPanel.classList.remove("hidden");
    sidebarPanel.classList.add("hidden");
    playbookPanel.classList.add("hidden");
  });

  function refreshPlaybookPanel() {
    if (!evalMode && viewingRunId !== 'current') {
      // Exiting eval mode while on a historical run — snap back to current session
      if (currentRunIssues.length) {
        renderPlaybookIssues(currentRunIssues, 'current', []);
      } else {
        playbookPanel.innerHTML = '';
        playbookBadge.textContent = '0';
        playbookBadge.classList.add('badge-hidden');
      }
      return;
    }
    if (viewingRunId === 'current') {
      if (currentRunIssues.length) renderPlaybookIssues(currentRunIssues, 'current', []);
      else if (evalMode && docHistory?.length) renderPlaybookIssues(docHistory[0].issues, docHistory[0].id, docHistory[0].evaluations || []);
    } else {
      const run = (docHistory || []).find(r => r.id === viewingRunId);
      if (run) renderPlaybookIssues(run.issues, run.id, run.evaluations || []);
    }
  }

  function renderPlaybookIssues(issues, activeRunId = 'current', evaluations = []) {
    viewingRunId = activeRunId;
    const historyBar = renderHistoryBar(activeRunId);
    if (!issues.length) {
      playbookPanel.innerHTML = historyBar + `<div class="empty-state"><p>No issues found — document matches Bolt's standard positions.</p></div>`;
      return;
    }

    // Build a lookup: issueIdx → [{ evaluator, submittedAt, verdict, comment }]
    const gradesByIssue = {};
    for (const ev of evaluations) {
      for (const [idx, grade] of Object.entries(ev.grades || {})) {
        if (!gradesByIssue[idx]) gradesByIssue[idx] = [];
        if (grade.verdict || grade.comment) {
          gradesByIssue[idx].push({ evaluator: ev.evaluator, submittedAt: ev.submittedAt, verdict: grade.verdict, comment: grade.comment });
        }
      }
    }

    const counts = { hard_stop: 0, negotiate: 0, acceptable: 0 };
    for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;

    let html = historyBar + `<div class="playbook-summary">
      ${counts.hard_stop  ? `<span class="playbook-summary-dot"><span class="severity-dot hard_stop"></span>${counts.hard_stop} hard stop${counts.hard_stop > 1 ? "s" : ""}</span>` : ""}
      ${counts.negotiate  ? `<span class="playbook-summary-dot"><span class="severity-dot negotiate"></span>${counts.negotiate} negotiable</span>` : ""}
      ${counts.acceptable ? `<span class="playbook-summary-dot"><span class="severity-dot acceptable"></span>${counts.acceptable} acceptable</span>` : ""}
    </div>`;

    issues.forEach((issue, i) => {
      const fallbackHtml = issue.fallback
        ? `<div class="playbook-body-text">${escapeHtml(issue.fallback)}</div>`
        : `<span class="playbook-fallback-none">None — do not concede</span>`;

      const pastGrades = gradesByIssue[i] || [];
      const pastEvalsHtml = pastGrades.length
        ? `<div class="past-evals eval-only">
            ${pastGrades.map(g => `
              <div class="past-eval-row">
                <span class="past-eval-verdict ${g.verdict || 'none'}">${g.verdict || '—'}</span>
                <span class="past-eval-name">${escapeHtml(g.evaluator)}</span>
                ${g.comment ? `<span class="past-eval-comment">${escapeHtml(g.comment)}</span>` : ''}
              </div>`).join('')}
          </div>`
        : '';

      html += `
        <div class="playbook-issue" data-severity="${issue.severity}" data-playbook="${i}">
          <div class="playbook-issue-header">
            <span class="severity-dot ${issue.severity}"></span>
            <span class="playbook-issue-title">${escapeHtml(issue.clause)}</span>
            <span class="playbook-issue-chevron">▶</span>
          </div>
          <div class="playbook-issue-deviation">${escapeHtml(issue.deviation)}</div>
          <div class="eval-grade-controls eval-only" data-issue="${i}">
            <div class="eval-grade-btns">
              <button class="eval-grade-btn" data-verdict="agree" data-issue="${i}">✓ Agree</button>
              <button class="eval-grade-btn" data-verdict="partial" data-issue="${i}">~ Partial</button>
              <button class="eval-grade-btn" data-verdict="disagree" data-issue="${i}">✗ Disagree</button>
            </div>
            <textarea class="eval-grade-comment" data-issue="${i}" placeholder="Comment (optional)…" rows="2"></textarea>
          </div>
          ${pastEvalsHtml}
          <div class="playbook-issue-body">
            ${issue.counterpartyText ? `<div class="playbook-body-quote">"${escapeHtml(issue.counterpartyText)}"</div>` : ""}
            <div class="playbook-body-section">
              <span class="playbook-body-label">Talking point</span>
              <div class="playbook-body-text">${escapeHtml(issue.talkingPoint)}</div>
            </div>
            <div class="playbook-body-section">
              <span class="playbook-body-label">Fallback</span>
              ${fallbackHtml}
            </div>
            ${issue.playbookSection ? `<button class="playbook-view-link" data-section="${escapeHtml(issue.playbookSection)}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              View in Playbook
            </button>` : ""}
          </div>
        </div>`;
    });

    html += `<div class="eval-submit-area eval-only">
      <button class="btn btn-primary eval-submit-btn">Submit evaluation</button>
    </div>`;

    playbookPanel.innerHTML = html;
    markPlaybookAnchors(issues);
    attachPlaybookHoverHandlers();
    attachEvalGradeHandlers();

    // History select handler (re-attached each render since innerHTML is replaced)
    document.getElementById('pb-history-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'current') {
        renderPlaybookIssues(currentRunIssues, 'current', []);
      } else {
        const run = (docHistory || []).find(r => r.id === val);
        if (run) renderPlaybookIssues(run.issues, run.id, run.evaluations || []);
      }
    });

    // Update badge and switch to Playbook tab
    playbookBadge.textContent = issues.length;
    playbookBadge.classList.remove("badge-hidden");
    tabPlaybook.click();
  }

  // ─── Chat ────────────────────────────────────────────────────────────────
  const chatMessages = document.getElementById("chat-messages");
  const chatInput    = document.getElementById("chat-input");
  const chatSend     = document.getElementById("chat-send");

  const chatHistory = []; // { role, content }

  function extractDocumentText() {
    // Read from the live DOM so user edits are captured
    if (documentPaper && documentPaper.innerText.trim()) {
      return documentPaper.innerText.trim();
    }
    if (!parsedDoc) return "";
    return parsedDoc.paragraphs
      .map(p => p.runs.map(r => r.text).join(""))
      .filter(t => t.trim())
      .join("\n\n");
  }

  function appendMessage(role) {
    // Remove welcome message on first real message
    const welcome = chatMessages.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    const wrap = document.createElement("div");
    wrap.className = `chat-msg ${role}`;
    wrap.innerHTML = `<span class="chat-msg-role">${role === "user" ? "You" : "Claude"}</span><div class="chat-msg-text"></div>`;
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return wrap.querySelector(".chat-msg-text");
  }

  async function runPlaybookReview() {
    chatInput.value = "";
    chatSend.disabled = true;

    const statusBubble = appendMessage("assistant");
    statusBubble.textContent = "Running NDA playbook review…";

    try {
      // Fetch and parse playbook sections (for modal links)
      try {
        const pbResp = await fetch("/asset/NDA%20Playbook.md");
        if (pbResp.ok) playbookSections = parsePlaybookSections(await pbResp.text());
      } catch (_) { /* non-fatal */ }

      const resp = await fetch("/api/review-playbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentText: extractDocumentText(), playbookSource }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      const issues = data.issues || [];
      currentRunIssues = issues;

      // Persist run, then refresh history so the bar is accurate before render
      try {
        const runResp = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractName: filenameEl.textContent || "unknown", issues }),
        });
        const runData = await runResp.json();
        currentRunId = runData.id;
        // Refresh history (now includes this run) before rendering
        try {
          const r = await fetch('/api/reviews');
          const { documents } = await r.json();
          const doc = documents.find(d => d.contractName === (filenameEl.textContent || "unknown"));
          docHistory = doc ? doc.runs : [];
        } catch { docHistory = docHistory || []; }
        // (eval-header-group already shown on doc load)
      } catch (_) { /* non-fatal */ }

      renderPlaybookIssues(issues, 'current', []);

      const hard = issues.filter(i => i.severity === "hard_stop").length;
      const neg  = issues.filter(i => i.severity === "negotiate").length;
      const acc  = issues.filter(i => i.severity === "acceptable").length;
      statusBubble.textContent = issues.length
        ? `Playbook review complete — ${issues.length} issue${issues.length > 1 ? "s" : ""} found: ${hard} hard stop${hard !== 1 ? "s" : ""}, ${neg} negotiable, ${acc} acceptable. See Playbook tab →`
        : "Playbook review complete — no deviations from Bolt's standard positions found.";
    } catch (e) {
      statusBubble.textContent = `Review failed: ${e.message}`;
    }

    chatSend.disabled = false;
  }

  function markStepAnchors(data) {
    // Remove existing step anchors
    documentPaper.querySelectorAll(".step-anchor").forEach(el => {
      el.replaceWith(document.createTextNode(el.textContent));
    });

    const tryWrap = (text, key) => {
      if (!text) return;
      const query = text.trim().slice(0, 80);
      if (!query) return;
      const walker = document.createTreeWalker(documentPaper, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const pos = node.textContent.indexOf(query);
        if (pos === -1) continue;
        const before = node.textContent.slice(0, pos);
        const after  = node.textContent.slice(pos + query.length);
        const span = document.createElement("span");
        span.className = "step-anchor";
        span.dataset.step = key;
        span.textContent = query;
        const parent = node.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after)  parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);
        break;
      }
    };

    (data.sections || []).forEach((sec, si) => {
      (sec.clauses || []).forEach((clause, ci) => tryWrap(clause.contractText, `${si}:${ci}`));
    });
    (data.anomalousClauses || []).forEach((item, ai) => tryWrap(item.contractText, `anon:${ai}`));
  }

  function attachStepHoverHandlers() {
    stepReviewPanel.querySelectorAll(".sr-clause[data-clause-key]").forEach(card => {
      const key = card.dataset.clauseKey;
      const anchors = () => [...documentPaper.querySelectorAll(`.step-anchor[data-step="${key}"]`)];

      card.addEventListener("mouseenter", () => {
        card.classList.add("highlighted");
        anchors().forEach(a => a.classList.add("highlighted"));
        drawConnectors(card, anchors(), "#0d9488");
      });
      card.addEventListener("mouseleave", () => {
        card.classList.remove("highlighted");
        anchors().forEach(a => a.classList.remove("highlighted"));
        clearConnectors();
      });
    });

    // Doc anchor → sidebar card highlight
    documentPaper.addEventListener("mouseover", (e) => {
      const a = e.target.closest(".step-anchor[data-step]");
      if (!a) return;
      stepReviewPanel.querySelector(`.sr-clause[data-clause-key="${a.dataset.step}"]`)?.classList.add("highlighted");
    });
    documentPaper.addEventListener("mouseout", (e) => {
      const a = e.target.closest(".step-anchor[data-step]");
      if (!a) return;
      stepReviewPanel.querySelector(`.sr-clause[data-clause-key="${a.dataset.step}"]`)?.classList.remove("highlighted");
    });
    documentPaper.addEventListener("click", (e) => {
      const a = e.target.closest(".step-anchor[data-step]");
      if (!a) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      tabStepReview.click();
      const card = stepReviewPanel.querySelector(`.sr-clause[data-clause-key="${a.dataset.step}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (!card.classList.contains("open")) card.classList.add("open");
        card.classList.add("highlighted");
        setTimeout(() => card.classList.remove("highlighted"), 1500);
      }
    });
  }

  function renderStepHistoryBar(activeRunId) {
    if (!evalMode) return '';
    const runs = stepDocHistory || [];
    const hasSession = !!currentStepRunId;
    if (!hasSession && !runs.length) return '';

    let options = '';
    if (hasSession) {
      const s = currentStepData?.sections || [];
      let n = 0; for (const sec of s) n += (sec.clauses || []).length;
      options += `<option value="current"${activeRunId === 'current' ? ' selected' : ''}>Current session · ${n} clause${n !== 1 ? 's' : ''}</option>`;
    }
    for (const run of runs) {
      if (run.id === currentStepRunId) continue;
      const d = new Date(run.createdAt);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      let n = 0; for (const sec of (run.sections || [])) n += (sec.clauses || []).length;
      const evCount = run.evaluations?.length || 0;
      const label = `${dateStr} · ${n} clause${n !== 1 ? 's' : ''}${evCount ? ` · ${evCount} eval${evCount > 1 ? 's' : ''}` : ''}`;
      options += `<option value="${escapeHtml(run.id)}"${activeRunId === run.id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }
    if (!options) return '';

    return `<div class="pb-history-bar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <select class="pb-history-select" id="sr-history-select">${options}</select>
    </div>`;
  }

  function renderStepReview(data, activeRunId = 'current', evaluations = []) {
    const sections = data.sections || [];
    const anomalous = data.anomalousClauses || [];

    // Build grades lookup: clauseKey → [{ evaluator, verdict, comment }]
    const gradesByClause = {};
    for (const ev of evaluations) {
      for (const [key, grade] of Object.entries(ev.grades || {})) {
        if (!gradesByClause[key]) gradesByClause[key] = [];
        if (grade.verdict || grade.comment) {
          gradesByClause[key].push({ evaluator: ev.evaluator, submittedAt: ev.submittedAt, verdict: grade.verdict, comment: grade.comment });
        }
      }
    }

    let greenCount = 0, yellowCount = 0, redCount = 0;
    for (const sec of sections) {
      for (const c of (sec.clauses || [])) {
        if (c.status === "green") greenCount++;
        else if (c.status === "yellow") yellowCount++;
        else redCount++;
      }
    }
    redCount += anomalous.length;

    const statusIcon = (status) => {
      if (status === "green")  return `<span class="sr-icon sr-green">✓</span>`;
      if (status === "yellow") return `<span class="sr-icon sr-yellow">?</span>`;
      return                          `<span class="sr-icon sr-red">!</span>`;
    };

    const historyBar = renderStepHistoryBar(activeRunId);

    let html = historyBar + `<div class="sr-summary">
      ${redCount    ? `<span class="sr-summary-item sr-red-text"><span class="sr-icon sr-red sr-icon-sm">!</span>${redCount} critical</span>` : ""}
      ${yellowCount ? `<span class="sr-summary-item sr-yellow-text"><span class="sr-icon sr-yellow sr-icon-sm">?</span>${yellowCount} negotiable</span>` : ""}
      ${greenCount  ? `<span class="sr-summary-item sr-green-text"><span class="sr-icon sr-green sr-icon-sm">✓</span>${greenCount} ok</span>` : ""}
    </div>`;

    sections.forEach((sec, si) => {
      if (!sec.clauses?.length) return;
      html += `<div class="sr-section">
        <div class="sr-section-title">${escapeHtml(sec.sectionTitle)}</div>`;
      sec.clauses.forEach((clause, ci) => {
        const key = `${si}:${ci}`;
        const pastGrades = gradesByClause[key] || [];
        const pastEvalsHtml = pastGrades.length
          ? `<div class="past-evals eval-only">
              ${pastGrades.map(g => `
                <div class="past-eval-row">
                  <span class="past-eval-verdict ${g.verdict || 'none'}">${g.verdict || '—'}</span>
                  <span class="past-eval-name">${escapeHtml(g.evaluator)}</span>
                  ${g.comment ? `<span class="past-eval-comment">${escapeHtml(g.comment)}</span>` : ''}
                </div>`).join('')}
            </div>`
          : '';
        html += `<div class="sr-clause" data-status="${clause.status}" data-clause-key="${key}">
          <div class="sr-clause-header">
            ${statusIcon(clause.status)}
            <span class="sr-clause-title">${escapeHtml(clause.clauseIssue)}</span>
            <span class="sr-clause-chevron">▶</span>
          </div>
          <div class="sr-clause-body">
            <div class="sr-clause-reasoning">${escapeHtml(clause.reasoning || "")}</div>
            <div class="eval-grade-controls eval-only" data-clause-key="${key}">
              <div class="eval-grade-btns">
                <button class="eval-grade-btn sr-eval-btn" data-verdict="agree" data-clause-key="${key}">✓ Agree</button>
                <button class="eval-grade-btn sr-eval-btn" data-verdict="partial" data-clause-key="${key}">~ Partial</button>
                <button class="eval-grade-btn sr-eval-btn" data-verdict="disagree" data-clause-key="${key}">✗ Disagree</button>
              </div>
              <textarea class="eval-grade-comment sr-eval-comment" data-clause-key="${key}" placeholder="Comment (optional)…" rows="2"></textarea>
            </div>
            ${pastEvalsHtml}
          </div>
        </div>`;
      });
      html += `</div>`;
    });

    if (anomalous.length) {
      html += `<div class="sr-section sr-anomalous-section">
        <div class="sr-section-title sr-anomalous-title">Anomalous Clauses</div>`;
      anomalous.forEach((item, ai) => {
        const key = `anon:${ai}`;
        const pastGrades = gradesByClause[key] || [];
        const pastEvalsHtml = pastGrades.length
          ? `<div class="past-evals eval-only">
              ${pastGrades.map(g => `
                <div class="past-eval-row">
                  <span class="past-eval-verdict ${g.verdict || 'none'}">${g.verdict || '—'}</span>
                  <span class="past-eval-name">${escapeHtml(g.evaluator)}</span>
                  ${g.comment ? `<span class="past-eval-comment">${escapeHtml(g.comment)}</span>` : ''}
                </div>`).join('')}
            </div>`
          : '';
        html += `<div class="sr-clause" data-status="red" data-clause-key="${key}">
          <div class="sr-clause-header">
            ${statusIcon("red")}
            <span class="sr-clause-title">${escapeHtml(item.description)}</span>
            <span class="sr-clause-chevron">▶</span>
          </div>
          <div class="sr-clause-body">
            ${item.contractText ? `<div class="sr-clause-quote">"${escapeHtml(item.contractText)}"</div>` : ""}
            <div class="sr-clause-reasoning">${escapeHtml(item.reasoning || "")}</div>
            <div class="eval-grade-controls eval-only" data-clause-key="${key}">
              <div class="eval-grade-btns">
                <button class="eval-grade-btn sr-eval-btn" data-verdict="agree" data-clause-key="${key}">✓ Agree</button>
                <button class="eval-grade-btn sr-eval-btn" data-verdict="partial" data-clause-key="${key}">~ Partial</button>
                <button class="eval-grade-btn sr-eval-btn" data-verdict="disagree" data-clause-key="${key}">✗ Disagree</button>
              </div>
              <textarea class="eval-grade-comment sr-eval-comment" data-clause-key="${key}" placeholder="Comment (optional)…" rows="2"></textarea>
            </div>
            ${pastEvalsHtml}
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    html += `<div class="eval-submit-area eval-only">
      <button class="btn btn-primary sr-eval-submit-btn">Submit evaluation</button>
    </div>`;

    stepReviewPanel.innerHTML = html;

    // Expand/collapse on click (header only, not eval controls)
    stepReviewPanel.querySelectorAll(".sr-clause").forEach(card => {
      card.querySelector(".sr-clause-header").addEventListener("click", () => {
        const opening = !card.classList.contains("open");
        card.classList.toggle("open");
        if (opening) {
          const key = card.dataset.clauseKey;
          const anchors = [...documentPaper.querySelectorAll(`.step-anchor[data-step="${key}"]`)];
          if (anchors.length) {
            clearConnectors();
            anchors[0].scrollIntoView({ behavior: "smooth", block: "center" });
            redrawOnScrollEnd(() => drawConnectors(card, anchors, "#0d9488"));
          }
        }
      });
    });

    markStepAnchors(data);
    attachStepHoverHandlers();
    attachStepEvalGradeHandlers();

    // History select handler
    document.getElementById('sr-history-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'current') {
        if (currentStepData) renderStepReview(currentStepData, 'current', []);
      } else {
        const run = (stepDocHistory || []).find(r => r.id === val);
        if (run) renderStepReview({ sections: run.sections, anomalousClauses: run.anomalousClauses }, run.id, run.evaluations || []);
      }
    });

    const total = greenCount + yellowCount + redCount;
    stepReviewBadge.textContent = total;
    stepReviewBadge.classList.remove("badge-hidden");
    tabStepReview.click();
  }

  function attachStepEvalGradeHandlers() {
    stepReviewPanel.addEventListener("click", (e) => {
      const btn = e.target.closest(".sr-eval-btn");
      if (!btn) return;
      const key = btn.dataset.clauseKey;
      const verdict = btn.dataset.verdict;
      const current = stepEvalGrades[key]?.verdict;
      if (current === verdict) {
        delete stepEvalGrades[key];
        btn.closest(".eval-grade-btns").querySelectorAll(".eval-grade-btn").forEach(b => b.classList.remove("active-agree","active-partial","active-disagree"));
        return;
      }
      if (!stepEvalGrades[key]) stepEvalGrades[key] = { verdict: "", comment: "" };
      stepEvalGrades[key].verdict = verdict;
      btn.closest(".eval-grade-btns").querySelectorAll(".eval-grade-btn").forEach(b => b.classList.remove("active-agree","active-partial","active-disagree"));
      btn.classList.add(`active-${verdict}`);
    });

    stepReviewPanel.addEventListener("input", (e) => {
      if (!e.target.matches(".sr-eval-comment")) return;
      const key = e.target.dataset.clauseKey;
      if (!stepEvalGrades[key]) stepEvalGrades[key] = { verdict: "", comment: "" };
      stepEvalGrades[key].comment = e.target.value;
    });

    stepReviewPanel.addEventListener("click", (e) => {
      if (!e.target.closest(".sr-eval-submit-btn")) return;
      submitStepEvaluation();
    });
  }

  async function submitStepEvaluation() {
    if (!currentStepRunId) { alert("No step review run to evaluate yet."); return; }
    if (!evalName) { alert("Please enter your name first."); return; }

    stepReviewPanel.querySelectorAll(".sr-eval-comment").forEach(ta => {
      const key = ta.dataset.clauseKey;
      if (!stepEvalGrades[key]) stepEvalGrades[key] = { verdict: "", comment: "" };
      stepEvalGrades[key].comment = ta.value;
    });

    try {
      const resp = await fetch("/api/step-evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: currentStepRunId, evaluator: evalName, grades: stepEvalGrades }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const graded = Object.keys(stepEvalGrades).length;
      appendMessage("assistant").textContent = `Step review evaluation submitted by ${evalName} — ${graded} clause${graded !== 1 ? 's' : ''} graded.`;
      stepEvalGrades = {};
      // Refresh history and re-render
      await loadStepDocHistory(filenameEl.textContent || "unknown");
    } catch (e) {
      appendMessage("assistant").textContent = `Step evaluation failed: ${e.message}`;
    }
  }

  async function runStepByStepReview() {
    chatSend.disabled = true;
    document.getElementById("btn-step-review").disabled = true;

    // Switch to tab and show loading state immediately
    stepReviewPanel.innerHTML = `
      <div class="sr-loading">
        <div class="sr-spinner"></div>
        <p class="sr-loading-text">Reviewing each clause against the contract…</p>
        <p class="sr-loading-sub">This takes 20–40 seconds</p>
      </div>`;
    tabStepReview.click();

    const statusBubble = appendMessage("assistant");
    statusBubble.textContent = "Running step-by-step clause review…";

    try {
      const resp = await fetch("/api/review-step-by-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentText: extractDocumentText() }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      currentStepData = data;

      // Persist run
      try {
        const runResp = await fetch("/api/step-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractName: filenameEl.textContent || "unknown", sections: data.sections, anomalousClauses: data.anomalousClauses }),
        });
        const runData = await runResp.json();
        currentStepRunId = runData.id;
        // Refresh history before render
        try {
          const r = await fetch('/api/step-reviews');
          const { documents } = await r.json();
          const doc = documents.find(d => d.contractName === (filenameEl.textContent || "unknown"));
          stepDocHistory = doc ? doc.runs : [];
        } catch { stepDocHistory = stepDocHistory || []; }
      } catch (_) { /* non-fatal */ }

      renderStepReview(data, 'current', []);

      const sections = data.sections || [];
      let green = 0, yellow = 0, red = 0;
      for (const sec of sections) {
        for (const c of (sec.clauses || [])) {
          if (c.status === "green") green++;
          else if (c.status === "yellow") yellow++;
          else red++;
        }
      }
      red += (data.anomalousClauses || []).length;
      statusBubble.textContent = `Step-by-step review complete — ${red} critical, ${yellow} negotiable, ${green} ok. See Step Review tab →`;
    } catch (e) {
      stepReviewPanel.innerHTML = `<div class="sr-loading sr-error"><p class="sr-loading-text">Review failed: ${escapeHtml(e.message)}</p></div>`;
      statusBubble.textContent = `Step review failed: ${e.message}`;
    }

    chatSend.disabled = false;
    document.getElementById("btn-step-review").disabled = false;
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || chatSend.disabled) return;

    if (text === "/review_nda") { runPlaybookReview(); return; }
    if (text === "/review_step_by_step") { runStepByStepReview(); return; }

    chatInput.value = "";
    chatInput.style.height = "auto";
    chatSend.disabled = true;

    chatHistory.push({ role: "user", content: text });
    appendMessage("user").textContent = text;

    const bubble = appendMessage("assistant");
    const cursor = document.createElement("span");
    cursor.className = "chat-cursor";
    bubble.appendChild(cursor);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory, documentText: extractDocumentText() }),
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") break;
          try {
            const { text: chunk, error } = JSON.parse(payload);
            if (error) { assistantText += `\n[Error: ${error}]`; }
            else if (chunk) { assistantText += chunk; }
          } catch { /* skip malformed */ }
        }
        cursor.remove();
        bubble.textContent = assistantText;
        bubble.appendChild(cursor);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      cursor.remove();
      bubble.textContent = assistantText;
      if (assistantText) chatHistory.push({ role: "assistant", content: assistantText });
    } catch (e) {
      cursor.remove();
      bubble.textContent = "Error: could not reach the server.";
      // Don't push error into history — remove the failed user message too
      chatHistory.pop();
    }

    chatSend.disabled = false;
    chatInput.focus();
  }

  document.getElementById("btn-review-nda").addEventListener("click", runPlaybookReview);
  document.getElementById("btn-step-review").addEventListener("click", runStepByStepReview);

  // Playbook source toggle
  let playbookSource = "app";
  document.getElementById("pb-source-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".pb-source-btn");
    if (!btn) return;
    playbookSource = btn.dataset.source;
    document.querySelectorAll(".pb-source-btn").forEach(b => b.classList.toggle("active", b === btn));
  });

  // ─── Evaluator mode ──────────────────────────────────────────────────────
  let evalMode = false;
  let evalName = "";
  let evalGrades = {};      // { issueIndex: { verdict, comment } }
  let evalMissedIssues = []; // array of missed issue objects
  let pendingMissedRange = null; // savedRange clone when missed toolbar clicked

  const evalToggleBtn = document.getElementById("eval-toggle-btn");
  const evalBadge     = document.getElementById("eval-badge");

  function enterEvalMode() {
    const name = prompt("Your name (shown on the evaluation record):");
    if (!name || !name.trim()) return;
    evalName = name.trim();
    evalMode = true;
    evalGrades = {};
    evalMissedIssues = [];
    document.body.classList.add("eval-mode");
    evalBadge.textContent = evalName;
    evalToggleBtn.textContent = "Exit Evaluator";
    evalToggleBtn.classList.add("active");
    tabPlaybook.click();
    refreshPlaybookPanel();
  }

  function exitEvalMode() {
    evalMode = false;
    document.body.classList.remove("eval-mode");
    evalToggleBtn.textContent = "Evaluator";
    evalToggleBtn.classList.remove("active");
    evalBadge.textContent = "";
    refreshPlaybookPanel();
  }

  evalToggleBtn.addEventListener("click", () => {
    if (evalMode) exitEvalMode();
    else enterEvalMode();
  });

  // Grade button clicks (delegated on playbookPanel)
  function attachEvalGradeHandlers() {
    playbookPanel.addEventListener("click", (e) => {
      const btn = e.target.closest(".eval-grade-btn");
      if (!btn) return;
      const idx = btn.dataset.issue;
      const verdict = btn.dataset.verdict;
      // Toggle off if already selected
      const current = evalGrades[idx]?.verdict;
      if (current === verdict) {
        delete evalGrades[idx];
        btn.closest(".eval-grade-btns").querySelectorAll(".eval-grade-btn").forEach(b => b.classList.remove("active-agree","active-partial","active-disagree"));
        return;
      }
      if (!evalGrades[idx]) evalGrades[idx] = { verdict: "", comment: "" };
      evalGrades[idx].verdict = verdict;
      btn.closest(".eval-grade-btns").querySelectorAll(".eval-grade-btn").forEach(b => b.classList.remove("active-agree","active-partial","active-disagree"));
      btn.classList.add(`active-${verdict}`);
    });

    playbookPanel.addEventListener("input", (e) => {
      if (!e.target.matches(".eval-grade-comment")) return;
      const idx = e.target.dataset.issue;
      if (!evalGrades[idx]) evalGrades[idx] = { verdict: "", comment: "" };
      evalGrades[idx].comment = e.target.value;
    });

    playbookPanel.addEventListener("click", (e) => {
      if (!e.target.closest(".eval-submit-btn")) return;
      submitEvaluation();
    });
  }

  async function submitEvaluation() {
    if (!currentRunId) { alert("No review run to evaluate yet."); return; }
    if (!evalName) { alert("Please enter your name first."); return; }

    // Collect comment textarea values at submit time
    playbookPanel.querySelectorAll(".eval-grade-comment").forEach(ta => {
      const idx = ta.dataset.issue;
      if (!evalGrades[idx]) evalGrades[idx] = { verdict: "", comment: "" };
      evalGrades[idx].comment = ta.value;
    });

    try {
      const resp = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: currentRunId, evaluator: evalName, grades: evalGrades, missedIssues: evalMissedIssues }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const graded = Object.keys(evalGrades).length;
      const statusBubble = appendMessage("assistant");
      statusBubble.textContent = `Evaluation submitted by ${evalName} — ${graded} issues graded, ${evalMissedIssues.length} missed issues added.`;
      exitEvalMode();
    } catch (e) {
      appendMessage("assistant").textContent = `Evaluation failed: ${e.message}`;
    }
  }

  // ─── Missed issue flow ────────────────────────────────────────────────────
  const missedPopover    = document.getElementById("missed-popover");
  const missedClauseSelect = document.getElementById("missed-clause-select");
  const missedComment    = document.getElementById("missed-comment");
  const missedGapNote    = document.getElementById("missed-gap-note");
  const missedNotInPb    = document.getElementById("missed-not-in-playbook");
  const tbMissed         = document.getElementById("tb-missed");

  // Populate clause select from known playbook sections
  PLAYBOOK_SECTION_HEADINGS.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = s;
    missedClauseSelect.appendChild(opt);
  });

  missedNotInPb.addEventListener("change", () => {
    missedGapNote.classList.toggle("hidden", !missedNotInPb.checked);
  });

  function openMissedPopover() {
    pendingMissedRange = savedRange ? savedRange.cloneRange() : null;
    hideToolbar();
    if (pendingMissedRange) {
      const rect = pendingMissedRange.getBoundingClientRect();
      missedPopover.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 340)}px`;
      missedPopover.style.top  = `${rect.bottom + window.scrollY + 8}px`;
    }
    missedComment.value = "";
    missedGapNote.value = "";
    missedNotInPb.checked = false;
    missedGapNote.classList.add("hidden");
    missedClauseSelect.value = "";
    missedPopover.classList.remove("hidden");
    missedComment.focus();
  }

  function closeMissedPopover() {
    missedPopover.classList.add("hidden");
    pendingMissedRange = null;
  }

  tbMissed.addEventListener("click", openMissedPopover);
  document.getElementById("missed-cancel-x").addEventListener("click", closeMissedPopover);
  document.getElementById("missed-cancel-btn").addEventListener("click", closeMissedPopover);

  document.getElementById("missed-submit-btn").addEventListener("click", () => {
    const clause     = missedClauseSelect.value;
    const severity   = document.querySelector("input[name='missed-sev']:checked")?.value || "negotiate";
    const comment    = missedComment.value.trim();
    const notInPb    = missedNotInPb.checked;
    const gapNote    = missedGapNote.value.trim();
    const selectedText = pendingMissedRange ? pendingMissedRange.toString().trim() : "";

    if (!selectedText && !comment) { missedComment.focus(); return; }

    // Wrap selected text in missed-anchor span
    if (pendingMissedRange) {
      const missedIdx = evalMissedIssues.length;
      savedRange = pendingMissedRange;
      const span = wrapSavedRange("missed-anchor", { missed: String(missedIdx) });
      if (span) span.title = clause || "Missed issue";
    }

    evalMissedIssues.push({ selectedText, clause, severity, comment, notInPlaybook: notInPb, playbookGapNote: gapNote });
    closeMissedPopover();

    // Show confirmation in chat
    const bubble = appendMessage("assistant");
    bubble.textContent = `Missed issue added: "${selectedText.slice(0, 60)}${selectedText.length > 60 ? "…" : ""}"${clause ? ` → ${clause}` : ""}`;
  });

  // Prevent mouseup from hiding toolbar when clicking inside missed popover
  document.addEventListener("mouseup", (e) => {
    if (missedPopover.contains(e.target)) return;
  }, true);

  document.getElementById("missed-browse-btn").addEventListener("click", () => {
    openPlaybookDrawer();
  });

  // ─── Playbook drawer ─────────────────────────────────────────────────────
  const pbDrawer        = document.getElementById("pb-drawer");
  const pbDrawerOverlay = document.getElementById("pb-drawer-overlay");
  const pbDrawerBody    = document.getElementById("pb-drawer-body");
  const pbDrawerSearch  = document.getElementById("pb-drawer-search");

  async function ensurePlaybookLoaded() {
    if (Object.keys(playbookSections).length) return;
    try {
      const r = await fetch("/asset/NDA%20Playbook.md");
      if (r.ok) playbookSections = parsePlaybookSections(await r.text());
    } catch (_) {}
  }

  async function openPlaybookDrawer() {
    await ensurePlaybookLoaded();
    // Render sections
    pbDrawerBody.innerHTML = PLAYBOOK_SECTION_HEADINGS.map(section => {
      const content = playbookSections[section] ? formatPlaybookSectionHtml(playbookSections[section]) : "";
      return `<div class="pb-drawer-section">
        <div class="pb-drawer-section-header">
          <span class="pb-drawer-section-name">${escapeHtml(section)}</span>
          <button class="pb-drawer-select-btn" data-section="${escapeHtml(section)}">Select</button>
          <span class="pb-drawer-section-chevron">▶</span>
        </div>
        ${content ? `<div class="pb-drawer-section-body">${content}</div>` : ""}
      </div>`;
    }).join("");

    pbDrawerSearch.value = "";
    pbDrawer.classList.remove("hidden");
    pbDrawerOverlay.classList.remove("hidden");

    // Collapse toggle
    pbDrawerBody.querySelectorAll(".pb-drawer-section-header").forEach(hdr => {
      hdr.addEventListener("click", (e) => {
        if (e.target.closest(".pb-drawer-select-btn")) return;
        hdr.closest(".pb-drawer-section").classList.toggle("open");
      });
    });

    // Select button → fill clause field and close drawer
    pbDrawerBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".pb-drawer-select-btn");
      if (!btn) return;
      missedClauseSelect.value = btn.dataset.section;
      closePlaybookDrawer();
    });
  }

  function closePlaybookDrawer() {
    pbDrawer.classList.add("hidden");
    pbDrawerOverlay.classList.add("hidden");
  }

  document.getElementById("pb-drawer-close").addEventListener("click", closePlaybookDrawer);
  pbDrawerOverlay.addEventListener("click", closePlaybookDrawer);

  pbDrawerSearch.addEventListener("input", () => {
    const q = pbDrawerSearch.value.toLowerCase();
    pbDrawerBody.querySelectorAll(".pb-drawer-section").forEach(s => {
      s.style.display = s.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });

  // ─── Playbook modal ──────────────────────────────────────────────────────
  const pbModal      = document.getElementById("playbook-modal");
  const pbModalTitle = document.getElementById("pb-modal-title");
  const pbModalBody  = document.getElementById("pb-modal-body");
  const pbModalClose = document.getElementById("pb-modal-close");

  let cachedPlaybookData = null;

  function renderPlaybookSectionForModal(section) {
    return section.clauses.map(clause => {
      const escalations = (clause.escalationTriggers || []).filter(Boolean);
      const fallbacks   = (clause.fallbackPositions || []).filter(Boolean);
      const dilutions   = (clause.nonPermissibleDilutions || []).filter(Boolean);
      const checklist   = (clause.checklist || []).filter(Boolean);
      const laws        = (clause.applicableLaw || []).filter(Boolean);
      return `
      <div class="pb-modal-clause">
        <div class="pb-modal-clause-header">
          <span class="pb-modal-clause-title">${escapeHtml(clause.issue)}</span>
          ${laws.length ? `<span class="pb-modal-law-chips">${laws.map(l => `<span class="pb-modal-law-chip">${escapeHtml(l)}</span>`).join('')}</span>` : ''}
        </div>
        ${clause.clauseExtract ? `
          <div class="pb-modal-field">
            <div class="pb-modal-field-label">Clause Extract</div>
            <div class="pb-modal-field-body">${escapeHtml(clause.clauseExtract)}</div>
          </div>` : ''}
        ${clause.complianceRationale ? `
          <div class="pb-modal-field">
            <div class="pb-modal-field-label">Compliance Rationale</div>
            <div class="pb-modal-field-body">${escapeHtml(clause.complianceRationale)}</div>
          </div>` : ''}
        ${escalations.length ? `
          <div class="pb-modal-field pb-modal-field-danger">
            <div class="pb-modal-field-label">Escalation Triggers</div>
            <ul class="pb-modal-list">${escalations.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
          </div>` : ''}
        ${checklist.length ? `
          <div class="pb-modal-field">
            <div class="pb-modal-field-label">Checklist</div>
            <ul class="pb-modal-list">${checklist.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
          </div>` : ''}
        ${fallbacks.length ? `
          <div class="pb-modal-field">
            <div class="pb-modal-field-label">Fallback Positions</div>
            <ol class="pb-modal-list">${fallbacks.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ol>
          </div>` : ''}
        ${dilutions.length ? `
          <div class="pb-modal-field pb-modal-field-redlines">
            <div class="pb-modal-field-label">Non-Permissible Dilutions</div>
            <ul class="pb-modal-list">${dilutions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
          </div>` : ''}
      </div>`;
    }).join('');
  }

  async function openPlaybookModal(sectionName) {
    pbModalTitle.textContent = sectionName;
    pbModalBody.innerHTML = `<div class="pb-modal-loading">Loading…</div>`;
    pbModal.classList.remove("hidden");

    try {
      if (!cachedPlaybookData) {
        const r = await fetch('/api/playbook-data');
        cachedPlaybookData = await r.json();
      }
      const section = (cachedPlaybookData.sections || []).find(s => s.title === sectionName);
      pbModalBody.innerHTML = section?.clauses?.length
        ? renderPlaybookSectionForModal(section)
        : `<p class="pb-modal-empty">Section not found in playbook.</p>`;
    } catch {
      pbModalBody.innerHTML = `<p class="pb-modal-empty" style="color:#ef4444">Failed to load playbook.</p>`;
    }
  }

  pbModalClose.addEventListener("click", () => pbModal.classList.add("hidden"));
  pbModal.addEventListener("click", (e) => { if (e.target === pbModal) pbModal.classList.add("hidden"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") pbModal.classList.add("hidden"); });

  // Delegate clicks on "View in Playbook" buttons inside the playbook panel
  document.getElementById("playbook-panel").addEventListener("click", (e) => {
    const btn = e.target.closest(".playbook-view-link");
    if (btn) { e.stopPropagation(); openPlaybookModal(btn.dataset.section); }
  });

  chatSend.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // ─── Auto-load from URL param (?name=filename) ───────────────────────────
  (async () => {
    const docName = new URLSearchParams(location.search).get('name');
    if (!docName) return;
    const cached = sessionStorage.getItem('docData_' + docName);
    if (cached) {
      sessionStorage.removeItem('docData_' + docName);
      renderApp(docName, JSON.parse(cached));
      return;
    }
    // Re-fetch from server (file was saved on first upload)
    try {
      const resp = await fetch('/api/doc/' + encodeURIComponent(docName));
      if (!resp.ok) return; // fall through to upload screen
      const blob = await resp.blob();
      handleFile(new File([blob], docName, { type: blob.type }));
    } catch { /* fall through to upload screen */ }
  })();
})();
