import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { parseDocx } from "./docxParser";
import { exportDocx } from "./docxExporter";

const app = express();
const port = parseInt(process.env.PORT || "8080", 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use("/asset", express.static(path.join(__dirname, "../asset")));

// ─── Data helpers (needed early by /api/parse) ────────────────────────────
const DATA_DIR = path.join(__dirname, "../data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJsonFile<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8")); }
  catch { return fallback; }
}
function writeJsonFile(file: string, data: unknown) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ─── Page routes (before static so they take precedence) ──────────────────
app.get("/",       (_req, res) => res.sendFile(path.join(__dirname, "../public/dashboard.html")));
app.get("/doc",    (_req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from Boltable!", time: new Date().toISOString() });
});

app.post("/api/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    if (!req.file.originalname.toLowerCase().endsWith(".docx")) {
      res.status(400).json({ error: "Only .docx files are supported" });
      return;
    }
    // Save file so it can be re-opened later
    const safeFilename = path.basename(req.file.originalname);
    const docsDir = path.join(DATA_DIR, "docs");
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, safeFilename), req.file.buffer);

    const parsed = await parseDocx(req.file.buffer);
    res.json(parsed);
  } catch (err) {
    console.error("Parse error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to parse document" });
  }
});

app.post("/api/export", async (req, res) => {
  try {
    const { filename, annotations } = req.body as {
      filename: string;
      annotations: { insertions: unknown[]; deletions: unknown[]; comments: unknown[] };
    };
    if (!filename || !annotations) {
      res.status(400).json({ error: "Missing filename or annotations" });
      return;
    }
    const safeFilename = path.basename(filename);
    const filePath = path.join(DATA_DIR, "docs", safeFilename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Original file not found on server. Please re-upload." });
      return;
    }
    const buffer = fs.readFileSync(filePath);
    const exported = await exportDocx(buffer, annotations as Parameters<typeof exportDocx>[1]);
    const outName = safeFilename.replace(/\.docx$/i, "_annotated.docx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.send(exported);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

app.get("/api/doc/:filename", (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const file = path.join(DATA_DIR, "docs", safeFilename);
  if (!fs.existsSync(file)) { res.status(404).json({ error: "File not found" }); return; }
  res.sendFile(file);
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, documentText } = req.body as {
      messages: { role: "user" | "assistant"; content: string }[];
      documentText?: string;
    };

    const system = documentText
      ? `You are a legal document assistant. The user will ask questions about the following document. Be concise and precise.\n\n<document>\n${documentText}\n</document>`
      : "You are a legal document assistant. Be concise and precise.";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.write(`data: ${JSON.stringify({ error: "Failed to get response" })}\n\n`);
    res.end();
  }
});

function playbookToText(data: any): string {
  const lines: string[] = [];
  for (const section of (data.sections || [])) {
    lines.push(`\n## ${section.title}`);
    for (const clause of (section.clauses || [])) {
      lines.push(`\n### ${clause.issue}`);
      if (clause.clauseExtract)       lines.push(`Standard Clause: ${clause.clauseExtract}`);
      if (clause.complianceRationale) lines.push(`Compliance Rationale: ${clause.complianceRationale}`);
      const triggers = (clause.escalationTriggers || []).filter(Boolean);
      if (triggers.length) lines.push(`Escalation Triggers (hard_stop if any apply):\n${triggers.map((t: string) => `  - ${t}`).join('\n')}`);
      const checklist = (clause.checklist || []).filter(Boolean);
      if (checklist.length) lines.push(`Checklist (must be present):\n${checklist.map((c: string) => `  - ${c}`).join('\n')}`);
      const fallbacks = (clause.fallbackPositions || []).filter(Boolean);
      if (fallbacks.length) lines.push(`Fallback Positions:\n${fallbacks.map((f: string, i: number) => `  ${i + 1}. ${f}`).join('\n')}`);
      const dilutions = (clause.nonPermissibleDilutions || []).filter(Boolean);
      if (dilutions.length) lines.push(`Never Accept:\n${dilutions.map((d: string) => `  - ${d}`).join('\n')}`);
    }
  }
  return lines.join("\n");
}

app.post("/api/review-playbook", async (req, res) => {
  try {
    const { documentText, playbookSource } = req.body as { documentText: string; playbookSource?: string };
    const playbookText = playbookSource === "md"
      ? fs.readFileSync(path.join(__dirname, "../asset/NDA Playbook.md"), "utf-8")
      : playbookToText(getPlaybookData());

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: `You are a legal contract reviewer for Bolt Technology. Analyze counterparty NDAs against Bolt's NDA Playbook.

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "issues": [
    {
      "clause": "clause name from playbook",
      "playbookSection": "exact section heading from the playbook (e.g. 'Definition of Affiliates', 'Scope, Term, and Termination', 'Injunctive Relief')",
      "severity": "hard_stop" | "negotiate" | "acceptable",
      "deviation": "one sentence: what the counterparty NDA says that differs from Bolt standard",
      "counterpartyText": "short relevant quote from counterparty NDA, max 120 chars",
      "talkingPoint": "Bolt talking point from playbook, condensed",
      "fallback": "fallback option from playbook, or null if none"
    }
  ]
}

Severity rules:
- "hard_stop": counterparty text hits an escalation trigger OR contains language from Never Accept list
- "negotiate": clause deviates from standard but no escalation trigger is hit and fallback positions exist
- "acceptable": minor deviation; all checklist items still present
Only include clauses where a real deviation or issue exists. Skip clauses that fully match Bolt's standard.
For playbookSection, use the exact heading as it appears in the playbook document (e.g. "Preamble", "Purpose", "Definition of Confidential Information").`,
      messages: [{
        role: "user",
        content: `PLAYBOOK:\n${playbookText}\n\nCOUNTERPARTY NDA:\n${documentText}`
      }]
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    // Extract JSON even if model wraps it in markdown
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { issues: [] };
    res.json(parsed);
  } catch (err) {
    console.error("Playbook review error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Review failed" });
  }
});

function buildStepByStepPlaybookText(data: any): string {
  const lines: string[] = [];
  for (const section of (data.sections || [])) {
    lines.push(`\n## SECTION: ${section.title}`);
    for (const clause of (section.clauses || [])) {
      lines.push(`### CLAUSE: ${clause.issue}`);
      if (clause.clauseExtract)       lines.push(`Bolt Standard: ${clause.clauseExtract}`);
      if (clause.complianceRationale) lines.push(`Compliance: ${clause.complianceRationale}`);
      const triggers = (clause.escalationTriggers || []).filter(Boolean);
      if (triggers.length) lines.push(`Escalation Triggers (→ RED if hit):\n${triggers.map((t: string) => `  - ${t}`).join('\n')}`);
      const checklist = (clause.checklist || []).filter(Boolean);
      if (checklist.length) lines.push(`Required Checklist:\n${checklist.map((c: string) => `  - ${c}`).join('\n')}`);
      const fallbacks = (clause.fallbackPositions || []).filter(Boolean);
      if (fallbacks.length) lines.push(`Fallback Positions (→ YELLOW if needed):\n${fallbacks.map((f: string, i: number) => `  ${i + 1}. ${f}`).join('\n')}`);
      const dilutions = (clause.nonPermissibleDilutions || []).filter(Boolean);
      if (dilutions.length) lines.push(`Never Accept (→ RED if present):\n${dilutions.map((d: string) => `  - ${d}`).join('\n')}`);
    }
  }
  return lines.join('\n');
}

app.post("/api/review-step-by-step", async (req, res) => {
  try {
    const { documentText } = req.body as { documentText: string };
    const playbookData = getPlaybookData();
    const playbookText = buildStepByStepPlaybookText(playbookData);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: `You are a legal contract reviewer for Bolt Technology. Do a comprehensive clause-by-clause review of a counterparty NDA against Bolt's NDA Playbook.

For EACH clause listed in the playbook, analyze the counterparty NDA and assign a status:
- "green": The clause is addressed acceptably. All checklist items present, no escalation triggers hit, within Bolt's acceptable range.
- "yellow": The clause deviates from Bolt's standard in a negotiable way — fallback positions exist that could resolve this. Not a hard stop.
- "red": One or more: (1) escalation trigger hit, (2) "Never Accept" language present, (3) required clause is entirely missing, (4) wording requires legal escalation.

Return ONLY a valid JSON object, no markdown:
{
  "sections": [
    {
      "sectionTitle": "exact section title from playbook",
      "clauses": [
        {
          "clauseIssue": "exact clause issue text from playbook",
          "status": "green",
          "contractText": "exact short quote from the counterparty NDA relevant to this clause, max 80 chars, or null if clause is absent",
          "reasoning": "2-3 sentences citing specific contract language or absence of it"
        }
      ]
    }
  ],
  "anomalousClauses": [
    {
      "description": "brief description",
      "contractText": "short relevant quote, max 100 chars",
      "reasoning": "why this clause is unusual/problematic for a mutual NDA"
    }
  ]
}

anomalousClauses lists clauses in the counterparty NDA that are non-standard or inappropriate for a mutual NDA (e.g., IP assignment, non-compete, unlimited liability caps, indemnification). If none, return empty array.
You MUST include every section and every clause from the playbook in your response, even if status is green.`,
      messages: [{
        role: "user",
        content: `PLAYBOOK:\n${playbookText}\n\nCOUNTERPARTY NDA:\n${documentText}`
      }]
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { sections: [], anomalousClauses: [] };
    res.json(parsed);
  } catch (err) {
    console.error("Step-by-step review error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Review failed" });
  }
});

// ─── Eval storage ────────────────────────────────────────────────────────────

app.post("/api/runs", (req, res) => {
  const { contractName, issues } = req.body as { contractName: string; issues: unknown[] };
  const runs = readJsonFile<any[]>("runs.json", []);
  const run = { id: randomUUID(), contractName, model: "claude-sonnet-4-6", createdAt: new Date().toISOString(), issues };
  runs.push(run);
  writeJsonFile("runs.json", runs);
  res.json({ id: run.id });
});

app.get("/api/runs", (_req, res) => {
  res.json(readJsonFile("runs.json", []));
});

app.post("/api/evaluations", (req, res) => {
  const { runId, evaluator, grades, missedIssues } = req.body as {
    runId: string; evaluator: string;
    grades: Record<string, { verdict: string; comment: string }>;
    missedIssues: unknown[];
  };
  const evals = readJsonFile<any[]>("evaluations.json", []);
  const evaluation = { id: randomUUID(), runId, evaluator, submittedAt: new Date().toISOString(), grades, missedIssues };
  evals.push(evaluation);
  writeJsonFile("evaluations.json", evals);
  res.json({ id: evaluation.id });
});

// ─── Step review storage ─────────────────────────────────────────────────────

app.post("/api/step-runs", (req, res) => {
  const { contractName, sections, anomalousClauses } = req.body as {
    contractName: string; sections: unknown[]; anomalousClauses: unknown[];
  };
  const runs = readJsonFile<any[]>("step-runs.json", []);
  const run = {
    id: randomUUID(), contractName,
    model: "claude-sonnet-4-6",
    createdAt: new Date().toISOString(),
    sections, anomalousClauses,
  };
  runs.push(run);
  writeJsonFile("step-runs.json", runs);
  res.json({ id: run.id });
});

app.get("/api/step-reviews", (_req, res) => {
  const runs  = readJsonFile<any[]>("step-runs.json", []);
  const evals = readJsonFile<any[]>("step-evaluations.json", []);
  const runsWithEvals = runs.map(run => ({
    ...run,
    evaluations: evals.filter(e => e.runId === run.id),
  }));
  const docMap = new Map<string, any[]>();
  for (const run of runsWithEvals) {
    if (!docMap.has(run.contractName)) docMap.set(run.contractName, []);
    docMap.get(run.contractName)!.push(run);
  }
  const documents = Array.from(docMap.entries()).map(([contractName, docRuns]) => ({
    contractName,
    runs: docRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  }));
  res.json({ documents });
});

app.post("/api/step-evaluations", (req, res) => {
  const { runId, evaluator, grades } = req.body as {
    runId: string; evaluator: string;
    grades: Record<string, { verdict: string; comment: string }>;
  };
  const evals = readJsonFile<any[]>("step-evaluations.json", []);
  const evaluation = { id: randomUUID(), runId, evaluator, submittedAt: new Date().toISOString(), grades };
  evals.push(evaluation);
  writeJsonFile("step-evaluations.json", evals);
  res.json({ id: evaluation.id });
});

// ─── Playbook management ──────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function deriveSeverity(fallback: string): "hard_stop" | "negotiate" | "acceptable" {
  const fb = fallback.trim().toLowerCase();
  if (!fb || fb.startsWith("none")) return "hard_stop";
  if (fb.includes("can be agreed") || fb.startsWith("okay to accept") ||
      fb.startsWith("this is okay") || fb.includes("bolt will accept this revision")) return "acceptable";
  return "negotiate";
}

function extractClauses(content: string): any[] {
  const lines = content.split("\n");
  const clauses: any[] = [];
  let cur: any = null;
  let field: string | null = null;

  function finish() {
    if (!cur) return;
    cur.severity = deriveSeverity(cur.acceptableFallback);
    clauses.push(cur);
    cur = null; field = null;
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t || t === "Negotiation Points") continue;
    if (t.startsWith("exclamation mark")) {
      finish();
      cur = { issue: t.replace(/^exclamation mark(Issue\s*\d*:?\s*)/i, "").trim(), preferredPosition: "", acceptableFallback: "", redlines: "", severity: "negotiate", notes: "", library: { contractClauses: [], emailTemplates: [], standardResponses: [] } };
      field = "issue";
    } else if (t.startsWith("megaphone")) {
      field = "preferred";
      if (cur) cur.preferredPosition = t.replace(/^megaphoneTalking Point:\s*/i, "").trim();
    } else if (t.startsWith("fire")) {
      field = "fallback";
      if (cur) cur.acceptableFallback = t.replace(/^fire\s*Fallback Option:\s*/i, "").trim();
    } else if (t.startsWith("star")) {
      const txt = "\n• " + t.replace(/^star/, "").trim();
      if (cur && field === "preferred") cur.preferredPosition += txt;
      else if (cur && field === "fallback") cur.acceptableFallback += txt;
    } else if (cur && field && t) {
      if (field === "issue") cur.issue += " " + t;
      else if (field === "preferred") cur.preferredPosition += " " + t;
      else if (field === "fallback") cur.acceptableFallback += " " + t;
    }
  }
  finish();
  return clauses;
}

function parsePlaybookMarkdown(text: string): any {
  const HEADINGS = [
    "Preamble","Purpose","Definition of Affiliates","Definition of Business Day",
    "Definition of Confidential Information","Exclusions",
    "Use and Disclosure of Confidential Information","Receiving Party Personnel Affiliates",
    "Disclosures to Governmental Entities","Ownership of Confidential Information",
    "Notice of Unauthorised Use","Return of Confidential Information",
    "Injunctive Relief","Penalties","Scope, Term, and Termination","Warranties","Miscellaneous",
  ];
  const lines = text.split("\n");
  const sections: any[] = [];
  let curTitle: string | null = null;
  let buf: string[] = [];

  function flush() {
    if (!curTitle) return;
    sections.push({ id: slugify(curTitle), title: curTitle, clauses: extractClauses(buf.join("\n")) });
  }

  for (const line of lines) {
    const t = line.trim();
    if (HEADINGS.includes(t)) { flush(); curTitle = t; buf = []; }
    else if (curTitle) buf.push(line);
  }
  flush();

  return {
    version: 2,
    sections,
    severityActions: {
      hard_stop:  { label: "Hard Stop",   description: "Raise to legal via Jira SD ticket. Do not negotiate — this is a blocker." },
      negotiate:  { label: "Negotiate",   description: "Apply fallback wording if available. Raise Jira ticket to track negotiation." },
      acceptable: { label: "Acceptable",  description: "Minor deviation. Document it. No action required." },
    },
    clauseLibrary: { contractClauses: [], emailTemplates: [], standardResponses: [] },
    decisionTrees: [],
  };
}

function migratePlaybookData(data: any): any {
  let changed = false;
  (data.sections || []).forEach((section: any) => {
    (section.clauses || []).forEach((clause: any) => {
      // v1 → v2: rename talkingPoint/fallback
      if (clause.talkingPoint !== undefined && clause.preferredPosition === undefined) {
        clause.preferredPosition = clause.talkingPoint; delete clause.talkingPoint; changed = true;
      }
      if (clause.fallback !== undefined && clause.acceptableFallback === undefined) {
        clause.acceptableFallback = clause.fallback; delete clause.fallback; changed = true;
      }
      // v2 → v3: new clause data model
      if (clause.preferredPosition !== undefined || clause.acceptableFallback !== undefined || clause.redlines !== undefined || clause.severity !== undefined) {
        if (clause.clauseExtract === undefined)          { clause.clauseExtract = clause.preferredPosition || ''; changed = true; }
        if (clause.complianceRationale === undefined)    { clause.complianceRationale = ''; changed = true; }
        if (clause.applicableLaw === undefined)          { clause.applicableLaw = []; changed = true; }
        if (clause.escalationTriggers === undefined)     { clause.escalationTriggers = []; changed = true; }
        if (clause.checklist === undefined)              { clause.checklist = []; changed = true; }
        if (clause.fallbackPositions === undefined) {
          const fb = clause.acceptableFallback || '';
          clause.fallbackPositions = fb ? [fb, '', ''] : ['', '', ''];
          changed = true;
        }
        if (clause.generalNotes === undefined)           { clause.generalNotes = clause.notes || ''; changed = true; }
        if (clause.nonPermissibleDilutions === undefined) {
          const rl = clause.redlines || '';
          clause.nonPermissibleDilutions = rl ? rl.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
          changed = true;
        }
        delete clause.severity; delete clause.preferredPosition; delete clause.acceptableFallback;
        delete clause.redlines; delete clause.notes;
        changed = true;
      }
      if (!clause.library) { clause.library = { contractClauses: [], emailTemplates: [], standardResponses: [] }; changed = true; }
    });
  });
  if (!data.clauseLibrary) { data.clauseLibrary = { contractClauses: [], emailTemplates: [], standardResponses: [] }; changed = true; }
  if (!data.decisionTrees) { data.decisionTrees = []; changed = true; }
  if (changed) { data.version = 3; writeJsonFile("playbook.json", data); }
  return data;
}

function getPlaybookData(): any {
  const existing = readJsonFile<any>("playbook.json", null);
  if (existing) return migratePlaybookData(existing);
  try {
    const md = fs.readFileSync(path.join(__dirname, "../asset/NDA Playbook.md"), "utf-8");
    const data = parsePlaybookMarkdown(md);
    writeJsonFile("playbook.json", data);
    return data;
  } catch { return { version: 1, sections: [], severityActions: {} }; }
}

app.get("/reviews", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/reviews.html"));
});

app.get("/api/reviews", (_req, res) => {
  const runs  = readJsonFile<any[]>("runs.json", []);
  const evals = readJsonFile<any[]>("evaluations.json", []);
  const runsWithEvals = runs.map(run => ({
    ...run,
    evaluations: evals.filter(e => e.runId === run.id),
  }));
  const docMap = new Map<string, any[]>();
  for (const run of runsWithEvals) {
    if (!docMap.has(run.contractName)) docMap.set(run.contractName, []);
    docMap.get(run.contractName)!.push(run);
  }
  const documents = Array.from(docMap.entries()).map(([contractName, docRuns]) => ({
    contractName,
    runs: docRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  }));
  res.json({ documents });
});

app.get("/playbook", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/playbook.html"));
});

app.get("/api/playbook-data", (_req, res) => {
  res.json(getPlaybookData());
});

app.put("/api/playbook-data", (req, res) => {
  writeJsonFile("playbook.json", req.body);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
