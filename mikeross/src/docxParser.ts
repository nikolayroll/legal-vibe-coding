import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface TextRun {
  text: string;
  type: "normal" | "insertion" | "deletion";
  revisionId?: string;
  author?: string;
  date?: string;
  commentIds?: string[]; // IDs of comments anchored over this run
}

export interface Paragraph {
  runs: TextRun[];
  style?: string;
}

export interface Comment {
  id: string;
  author: string;
  date: string;
  text: string;
  resolved?: boolean;
  parentId?: string;
  paraId?: string;
}

export interface ParsedDocument {
  paragraphs: Paragraph[];
  comments: Comment[];
  insertions: TextRun[];
  deletions: TextRun[];
}

// Ordered element from fast-xml-parser with preserveOrder:true
type OEl = Record<string, unknown>;

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
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
  if (Array.isArray(val)) return val as OEl[];
  return [];
}

function getTextContent(children: OEl[]): string {
  let text = "";
  for (const child of children) {
    const tag = oTag(child);
    if (tag === "#text") {
      text += String(child["#text"] ?? "");
    } else if (tag) {
      text += getTextContent(oChildren(child));
    }
  }
  return text;
}

function getChildTagText(el: OEl, tagName: string): string {
  for (const child of oChildren(el)) {
    if (oTag(child) === tagName) return getTextContent(oChildren(child));
  }
  return "";
}

function parseParagraph(paraChildren: OEl[]): Paragraph {
  const runs: TextRun[] = [];
  const openComments = new Set<string>();
  let style: string | undefined;

  for (const child of paraChildren) {
    const tag = oTag(child);
    if (!tag) continue;
    const attrs = oAttrs(child);

    if (tag === "w:pPr") {
      for (const pChild of oChildren(child)) {
        if (oTag(pChild) === "w:pStyle") {
          style = oAttrs(pChild)["@_w:val"];
        }
      }
    } else if (tag === "w:commentRangeStart") {
      const id = attrs["@_w:id"];
      if (id) openComments.add(id);
    } else if (tag === "w:commentRangeEnd") {
      const id = attrs["@_w:id"];
      if (id) openComments.delete(id);
    } else if (tag === "w:r") {
      const text = getChildTagText(child, "w:t");
      if (text) {
        runs.push({
          text,
          type: "normal",
          commentIds: openComments.size > 0 ? [...openComments] : undefined,
        });
      }
    } else if (tag === "w:ins") {
      const author = attrs["@_w:author"] ?? "";
      const date = attrs["@_w:date"] ?? "";
      const revisionId = attrs["@_w:id"] ?? "";
      for (const insChild of oChildren(child)) {
        if (oTag(insChild) !== "w:r") continue;
        const text = getChildTagText(insChild, "w:t");
        if (text) {
          runs.push({
            text,
            type: "insertion",
            author,
            date,
            revisionId,
            commentIds: openComments.size > 0 ? [...openComments] : undefined,
          });
        }
      }
    } else if (tag === "w:del") {
      const author = attrs["@_w:author"] ?? "";
      const date = attrs["@_w:date"] ?? "";
      const revisionId = attrs["@_w:id"] ?? "";
      for (const delChild of oChildren(child)) {
        if (oTag(delChild) !== "w:r") continue;
        const text = getChildTagText(delChild, "w:delText");
        if (text) {
          runs.push({
            text,
            type: "deletion",
            author,
            date,
            revisionId,
            commentIds: openComments.size > 0 ? [...openComments] : undefined,
          });
        }
      }
    }
  }

  return { runs, style };
}

function parseComments(commentsXml: string): Comment[] {
  const parser = new XMLParser(parserOptions);
  const parsed = parser.parse(commentsXml) as OEl[];

  const commentsRoot = parsed.find((el) => oTag(el) === "w:comments");
  if (!commentsRoot) return [];

  const comments: Comment[] = [];
  for (const commentEl of oChildren(commentsRoot)) {
    if (oTag(commentEl) !== "w:comment") continue;
    const attrs = oAttrs(commentEl);
    const id = attrs["@_w:id"] ?? "";
    const author = attrs["@_w:author"] ?? "Unknown";
    const date = attrs["@_w:date"] ?? "";
    const parentId = attrs["@_w:paraIdParent"];

    const textParts: string[] = [];
    let paraId: string | undefined;
    for (const pEl of oChildren(commentEl)) {
      if (oTag(pEl) !== "w:p") continue;
      if (paraId === undefined) paraId = oAttrs(pEl)["@_w:paraId"];
      for (const rEl of oChildren(pEl)) {
        if (oTag(rEl) !== "w:r") continue;
        const text = getChildTagText(rEl, "w:t");
        if (text) textParts.push(text);
      }
    }

    comments.push({ id, author, date, text: textParts.join(" ").trim(), parentId, paraId });
  }
  return comments;
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("Invalid .docx: missing word/document.xml");

  const parser = new XMLParser(parserOptions);
  const parsed = parser.parse(docXml) as OEl[];

  const docEl = parsed.find((el) => oTag(el) === "w:document");
  if (!docEl) throw new Error("Could not find w:document");

  const bodyEl = oChildren(docEl).find((el) => oTag(el) === "w:body");
  if (!bodyEl) throw new Error("Could not find w:body");

  const paragraphs: Paragraph[] = [];
  const insertions: TextRun[] = [];
  const deletions: TextRun[] = [];

  for (const child of oChildren(bodyEl)) {
    if (oTag(child) !== "w:p") continue;
    const para = parseParagraph(oChildren(child));
    paragraphs.push(para);
    for (const run of para.runs) {
      if (run.type === "insertion") insertions.push(run);
      if (run.type === "deletion") deletions.push(run);
    }
  }

  let comments: Comment[] = [];
  const commentsFile = zip.file("word/comments.xml");
  if (commentsFile) {
    const commentsXml = await commentsFile.async("string");
    comments = parseComments(commentsXml);
  }

  return { paragraphs, comments, insertions, deletions };
}
