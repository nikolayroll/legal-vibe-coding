import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AnnotationItem {
  text:       string;
  revisionId?: string;
  id?:        string;
  author?:    string;
  date?:      string;
  paraIndex?: number | null;
  charStart?: number | null;
  charEnd?:   number | null;
}

export interface AnnotationData {
  insertions: AnnotationItem[];
  deletions:  AnnotationItem[];
  comments:   AnnotationItem[];
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface PendingAnnotation {
  kind:       "ins" | "del" | "comment";
  numId:      string; // numeric string ID for OOXML attributes
  author:     string;
  date:       string;
  commentText?: string; // comment body text
  charStart:  number;
  charEnd:    number;
}

interface Segment {
  text:       string;
  startChar:  number;
  endChar:    number;
  rPr?:       OEl;
}

type OEl = Record<string, unknown>;

// ─── XML helpers ──────────────────────────────────────────────────────────────

const XML_PARSE_OPTS = {
  ignoreAttributes:       false,
  attributeNamePrefix:    "@_",
  allowBooleanAttributes: true,
  parseAttributeValue:    false,
  trimValues:             false,
  preserveOrder:          true,
};

const XML_BUILD_OPTS = {
  ignoreAttributes:    false,
  attributeNamePrefix: "@_",
  preserveOrder:       true,
  format:              false,
  suppressEmptyNode:   false,
};

function oTag(el: OEl): string | undefined {
  return Object.keys(el).find((k) => k !== ":@");
}

function oAttrs(el: OEl): Record<string, string> {
  return (el[":@"] as Record<string, string>) ?? {};
}

function oChildren(el: OEl): OEl[] {
  const tag = oTag(el);
  if (!tag || tag === "#text") return [];
  const val = el[tag];
  return Array.isArray(val) ? (val as OEl[]) : [];
}

function setChildren(el: OEl, children: OEl[]): void {
  const tag = oTag(el)!;
  (el as Record<string, unknown>)[tag] = children;
}

// Get the text content of a w:t or w:delText element
function getWtText(wtEl: OEl): string {
  for (const c of oChildren(wtEl)) {
    if (oTag(c) === "#text") return String(c["#text"] ?? "");
  }
  return "";
}

// Get run properties element from a w:r
function getRpr(runEl: OEl): OEl | undefined {
  return oChildren(runEl).find((c) => oTag(c) === "w:rPr");
}

// Build a w:r element with given text
function makeRun(text: string, rPr: OEl | undefined, textTag: "w:t" | "w:delText"): OEl {
  const children: OEl[] = [];
  if (rPr) children.push(rPr);
  children.push({
    [textTag]: [{ "#text": text }],
    ":@": { "@_xml:space": "preserve" },
  });
  return { "w:r": children };
}

// ─── Segment extraction ───────────────────────────────────────────────────────

// Build a flat list of text segments from a paragraph's children.
// Counts text from w:r, w:ins>w:r, and w:del>w:r so that char offsets
// match what the browser renders (all run types are rendered in the UI).
function extractSegments(paraChildren: OEl[]): Segment[] {
  let pos = 0;
  const segs: Segment[] = [];

  function addRun(runEl: OEl): void {
    for (const child of oChildren(runEl)) {
      const t = oTag(child);
      if (t === "w:t" || t === "w:delText") {
        const text = getWtText(child);
        if (text) {
          segs.push({ text, startChar: pos, endChar: pos + text.length, rPr: getRpr(runEl) });
          pos += text.length;
        }
      }
    }
  }

  for (const child of paraChildren) {
    const t = oTag(child);
    if (t === "w:r") {
      addRun(child);
    } else if (t === "w:ins" || t === "w:del") {
      for (const nested of oChildren(child)) {
        if (oTag(nested) === "w:r") addRun(nested);
      }
    }
    // pPr, bookmarkStart, commentRangeStart etc. contribute no text
  }

  return segs;
}

// Split segments at the given character boundaries
function splitAtBoundaries(segs: Segment[], boundaries: number[]): Segment[] {
  let result = [...segs];
  for (const b of [...new Set(boundaries)].sort((a, c) => a - c)) {
    const next: Segment[] = [];
    for (const s of result) {
      const localAt = b - s.startChar;
      if (localAt > 0 && localAt < s.text.length) {
        next.push({ ...s, text: s.text.slice(0, localAt), endChar: b });
        next.push({ ...s, text: s.text.slice(localAt), startChar: b });
      } else {
        next.push(s);
      }
    }
    result = next;
  }
  return result;
}

// ─── Paragraph rebuild ────────────────────────────────────────────────────────

function rebuildPara(
  paraEl: OEl,
  annos: PendingAnnotation[],
  idCounter: { val: number },
): void {
  const paraChildren = oChildren(paraEl);
  const pPr = paraChildren.find((c) => oTag(c) === "w:pPr");

  const segs = extractSegments(paraChildren);
  if (segs.length === 0) return;

  const boundaries: number[] = [];
  for (const a of annos) {
    boundaries.push(a.charStart, a.charEnd);
  }

  const splits = splitAtBoundaries(segs, boundaries);
  const newChildren: OEl[] = [];
  if (pPr) newChildren.push(pPr);

  const commentOpened = new Set<string>();
  const commentClosed = new Set<string>();

  for (const seg of splits) {
    if (!seg.text) continue;

    const anno = annos.find((a) => seg.startChar >= a.charStart && seg.endChar <= a.charEnd);

    if (anno?.kind === "comment" && !commentOpened.has(anno.numId)) {
      commentOpened.add(anno.numId);
      newChildren.push({ "w:commentRangeStart": [], ":@": { "@_w:id": anno.numId } });
    }

    if (!anno) {
      newChildren.push(makeRun(seg.text, seg.rPr, "w:t"));
    } else if (anno.kind === "ins") {
      newChildren.push({
        "w:ins": [makeRun(seg.text, seg.rPr, "w:t")],
        ":@": { "@_w:id": String(idCounter.val++), "@_w:author": anno.author, "@_w:date": anno.date },
      });
    } else if (anno.kind === "del") {
      newChildren.push({
        "w:del": [makeRun(seg.text, seg.rPr, "w:delText")],
        ":@": { "@_w:id": String(idCounter.val++), "@_w:author": anno.author, "@_w:date": anno.date },
      });
    } else if (anno.kind === "comment") {
      newChildren.push(makeRun(seg.text, seg.rPr, "w:t"));
    }

    if (anno?.kind === "comment" && !commentClosed.has(anno.numId)) {
      // Close if this is the last segment covered by this annotation
      const hasMore = splits.some(
        (s) => s.startChar > seg.startChar && s.startChar >= anno.charStart && s.endChar <= anno.charEnd,
      );
      if (!hasMore) {
        commentClosed.add(anno.numId);
        newChildren.push({ "w:commentRangeEnd": [], ":@": { "@_w:id": anno.numId } });
        newChildren.push({
          "w:r": [
            { "w:rPr": [{ "w:rStyle": [], ":@": { "@_w:val": "CommentReference" } }] },
            { "w:commentReference": [], ":@": { "@_w:id": anno.numId } },
          ],
        });
      }
    }
  }

  setChildren(paraEl, newChildren);
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

// Scan raw XML for the highest w:id value to avoid collisions
function findMaxId(xml: string): number {
  let max = 0;
  for (const m of xml.matchAll(/w:id="(\d+)"/g)) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

// ─── comments.xml helpers ─────────────────────────────────────────────────────

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCommentEntry(numId: string, author: string, date: string, text: string): string {
  return (
    `<w:comment w:id="${numId}" w:author="${escXml(author)}" w:date="${date}" w:initials="">` +
    `<w:p>` +
    `<w:pPr><w:pStyle w:val="CommentText"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>` +
    `<w:r><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>` +
    `</w:p>` +
    `</w:comment>`
  );
}

async function injectComments(
  zip: JSZip,
  entries: Array<{ numId: string; author: string; date: string; commentText: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  const commentXml = entries
    .map((e) => buildCommentEntry(e.numId, e.author, e.date, e.commentText))
    .join("");

  const commentsFile = zip.file("word/comments.xml");
  if (commentsFile) {
    let xml = await commentsFile.async("string");
    xml = xml.replace(/<\/w:comments>/, commentXml + "</w:comments>");
    zip.file("word/comments.xml", xml);
  } else {
    // Create comments.xml from scratch
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      commentXml +
      `</w:comments>`;
    zip.file("word/comments.xml", xml);

    // Register in [Content_Types].xml
    const ctFile = zip.file("[Content_Types].xml");
    if (ctFile) {
      let ct = await ctFile.async("string");
      if (!ct.includes("wordprocessingml.comments")) {
        ct = ct.replace(
          "</Types>",
          `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
        );
        zip.file("[Content_Types].xml", ct);
      }
    }

    // Register relationship in word/_rels/document.xml.rels
    const relsFile = zip.file("word/_rels/document.xml.rels");
    if (relsFile) {
      let rels = await relsFile.async("string");
      if (!rels.includes("relationships/comments")) {
        rels = rels.replace(
          "</Relationships>",
          `<Relationship Id="rIdComments1" ` +
            `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" ` +
            `Target="comments.xml"/></Relationships>`,
        );
        zip.file("word/_rels/document.xml.rels", rels);
      }
    }
  }
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportDocx(originalBuffer: Buffer, data: AnnotationData): Promise<Buffer> {
  const zip = await JSZip.loadAsync(originalBuffer);
  const docXmlRaw = await zip.file("word/document.xml")!.async("string");

  const parser = new XMLParser(XML_PARSE_OPTS);
  const parsed = parser.parse(docXmlRaw) as OEl[];

  // Navigate to w:body
  const docEl = parsed.find((el) => oTag(el) === "w:document");
  if (!docEl) throw new Error("w:document not found");
  const bodyEl = oChildren(docEl).find((el) => oTag(el) === "w:body");
  if (!bodyEl) throw new Error("w:body not found");
  const bodyChildren = oChildren(bodyEl);

  // Assign stable numeric IDs to all new annotations, avoiding existing ID collisions
  const idCounter = { val: findMaxId(docXmlRaw) + 1 };

  // Group annotations by paraIndex
  const byPara = new Map<number, PendingAnnotation[]>();
  const pendingComments: Array<{ numId: string; author: string; date: string; commentText: string }> = [];

  function register(item: AnnotationItem, kind: "ins" | "del" | "comment"): void {
    if (item.paraIndex == null || item.charStart == null || item.charEnd == null) return;
    const numId = String(idCounter.val++);
    const anno: PendingAnnotation = {
      kind,
      numId,
      author:    item.author ?? "You",
      date:      item.date   ?? new Date().toISOString(),
      charStart: item.charStart,
      charEnd:   item.charEnd,
    };
    if (kind === "comment") {
      anno.commentText = item.text;
      pendingComments.push({ numId, author: anno.author, date: anno.date, commentText: item.text });
    }
    const pi = item.paraIndex;
    if (!byPara.has(pi)) byPara.set(pi, []);
    byPara.get(pi)!.push(anno);
  }

  for (const ins of data.insertions) register(ins, "ins");
  for (const del of data.deletions)  register(del, "del");
  for (const com of data.comments)   register(com, "comment");

  // Walk body children and rebuild annotated paragraphs
  let paraIdx = 0;
  for (const child of bodyChildren) {
    if (oTag(child) !== "w:p") continue;
    const annos = byPara.get(paraIdx);
    if (annos?.length) rebuildPara(child, annos, idCounter);
    paraIdx++;
  }

  // Serialize modified document.xml
  const builder = new XMLBuilder(XML_BUILD_OPTS);
  zip.file("word/document.xml", builder.build(parsed));

  // Inject comments
  await injectComments(zip, pendingComments);

  return zip.generateAsync({ type: "nodebuffer" });
}
