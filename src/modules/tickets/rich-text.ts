// Server-side reading of TipTap documents (ticket descriptions and comment bodies), ported from
// the source client helpers so mentions and email previews come from stored content only.

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown };

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (node && typeof node === "object") {
    const current = node as Node;
    visit(current);
    if (Array.isArray(current.content)) walk(current.content, visit);
  }
}

const MEDIA_TYPES = new Set(["image", "table", "horizontalRule", "youtube"]);
const COMMENT_MEDIA_TYPES = new Set([
  "image",
  "table",
  "youtube",
  "horizontalRule",
  "taskList",
  "codeBlock",
]);

/** Description has text or media (legacy `{ text }` documents included). */
export function descriptionHasContent(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const legacy = (json as { text?: unknown }).text;
  if (typeof legacy === "string") return legacy.trim().length > 0;
  let found = false;
  walk((json as Node).content ?? json, (node) => {
    if (found) return;
    if (
      (typeof node.text === "string" && node.text.trim()) ||
      (node.type && MEDIA_TYPES.has(node.type))
    )
      found = true;
  });
  return found;
}

export function extractMentionIds(doc: unknown): string[] {
  const ids = new Set<string>();
  walk(doc, (node) => {
    if (node.type === "mention" && typeof node.attrs?.id === "string") ids.add(node.attrs.id);
  });
  return [...ids];
}

/** Plain text with `@Name` for mentions (email previews). */
export function docToText(doc: unknown): string {
  const lines: string[] = [];
  let current = "";
  walk(doc, (node) => {
    if (node.type === "paragraph" || node.type === "heading") {
      if (current) {
        lines.push(current);
        current = "";
      }
    } else if (typeof node.text === "string") current += node.text;
    else if (node.type === "mention" && typeof node.attrs?.label === "string")
      current += `@${node.attrs.label}`;
  });
  if (current) lines.push(current);
  return lines.join("\n").trim();
}

/** Comment bodies are stored as serialized TipTap JSON, or legacy plain text. */
export function parseCommentBody(body: string): { doc: unknown | null; text: string } {
  if (body.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { type?: string };
      if (parsed && parsed.type === "doc") return { doc: parsed, text: docToText(parsed) };
    } catch {
      /* legacy text that happens to start with "{" */
    }
  }
  return { doc: null, text: body };
}

export function commentHasContent(body: string): boolean {
  const { doc, text } = parseCommentBody(body);
  if (!doc) return text.trim().length > 0;
  let found = false;
  walk(doc, (node) => {
    if (found) return;
    if (node.type === "mention" || node.type === "docMention") found = true;
    else if (node.type && COMMENT_MEDIA_TYPES.has(node.type)) found = true;
    else if (typeof node.text === "string" && node.text.trim()) found = true;
  });
  return found;
}
