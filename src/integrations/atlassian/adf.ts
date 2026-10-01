// Atlassian Document Format (ADF) conversion, ported unchanged from the source app:
// plain text for comments and work-log notes, TipTap JSON for ticket descriptions.

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
};

type Doc = {
  type: string;
  content?: unknown[];
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: unknown[];
};

export type TipTapDoc = { type: "doc"; content: unknown[] };

/** Flattens ADF into plain text, keeping link targets as "text (href)". */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const n = node as AdfNode;
  if (n.type === "text") {
    const text = n.text ?? "";
    const link = (n.marks ?? []).find((m) => m?.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (href && href !== text) return `${text} (${href})`;
    return text;
  }
  if (n.type === "inlineCard" || n.type === "blockCard" || n.type === "embedCard") {
    return typeof n.attrs?.url === "string" ? n.attrs.url : "";
  }
  const inner = (n.content ?? []).map(adfToText).join("");
  if (n.type === "paragraph" || n.type === "heading" || n.type === "listItem") return `${inner}\n`;
  return inner;
}

/** One paragraph per line, the shape the ticket editor stores. */
export function textToDocumentJson(text: string): TipTapDoc {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: paragraphs.map((line) =>
      line.trim().length
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    ),
  };
}

const MARK_MAP: Record<string, string> = {
  strong: "bold",
  em: "italic",
  code: "code",
  strike: "strike",
  underline: "underline",
};

const linkMark = (href: string) => ({
  type: "link",
  attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" },
});

function textNode(text: string, marks: AdfNode["marks"]): Doc | null {
  if (!text) return null;
  const out: unknown[] = [];
  for (const m of marks ?? []) {
    if (!m?.type) continue;
    if (m.type === "link") {
      const href = typeof m.attrs?.href === "string" ? m.attrs.href : null;
      if (href) out.push(linkMark(href));
      continue;
    }
    const mapped = MARK_MAP[m.type];
    if (mapped) out.push({ type: mapped });
  }
  return out.length ? { type: "text", text, marks: out } : { type: "text", text };
}

function inline(nodes: AdfNode[] | undefined): Doc[] {
  const out: Doc[] = [];
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    switch (n.type) {
      case "text": {
        const t = textNode(n.text ?? "", n.marks);
        if (t) out.push(t);
        break;
      }
      case "hardBreak":
        out.push({ type: "hardBreak" });
        break;
      case "mention": {
        const label = String(n.attrs?.text ?? "").replace(/^@/, "");
        if (label) out.push({ type: "text", text: `@${label}` });
        break;
      }
      case "emoji": {
        const t = String(n.attrs?.text ?? n.attrs?.shortName ?? "");
        if (t) out.push({ type: "text", text: t });
        break;
      }
      case "inlineCard":
      case "blockCard":
      case "embedCard": {
        const url = typeof n.attrs?.url === "string" ? n.attrs.url : null;
        if (url) out.push({ type: "text", text: url, marks: [linkMark(url)] });
        break;
      }
      case "media":
      case "mediaSingle":
      case "mediaGroup":
        // Attachments are imported separately.
        break;
      default:
        out.push(...inline(n.content));
    }
  }
  return out;
}

function paragraph(content: Doc[]): Doc {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function block(n: AdfNode): Doc[] {
  switch (n.type) {
    case "paragraph":
      return [paragraph(inline(n.content))];
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      const content = inline(n.content);
      return [
        content.length ? { type: "heading", attrs: { level }, content } : { type: "paragraph" },
      ];
    }
    case "bulletList":
    case "orderedList": {
      const items = (n.content ?? []).map((li) => ({
        type: "listItem",
        content: blocks(li.content).filter((b) => b.type !== "listItem"),
      }));
      if (!items.length) return [];
      return [{ type: n.type, content: items }];
    }
    case "taskList":
      return [
        {
          type: "bulletList",
          content: (n.content ?? []).map((item) => ({
            type: "listItem",
            content: [paragraph(inline(item.content))],
          })),
        },
      ];
    case "codeBlock": {
      const text = (n.content ?? []).map((c) => c.text ?? "").join("");
      return [
        text ? { type: "codeBlock", content: [{ type: "text", text }] } : { type: "paragraph" },
      ];
    }
    case "blockquote":
    case "panel":
      return [{ type: "blockquote", content: blocks(n.content) }];
    case "rule":
      return [{ type: "horizontalRule" }];
    case "table": {
      // Tables are flattened into paragraphs to stay compatible with the editor schema.
      const rows: Doc[] = [];
      for (const row of n.content ?? []) {
        const cells = (row.content ?? []).map((cell) =>
          inline(cell.content?.flatMap((c) => c.content ?? []) ?? [])
            .map((t) => (typeof t.text === "string" ? t.text : ""))
            .join(""),
        );
        const line = cells.filter(Boolean).join(" | ");
        if (line) rows.push(paragraph([{ type: "text", text: line }]));
      }
      return rows;
    }
    case "mediaSingle":
    case "mediaGroup":
      return [];
    default: {
      const inner = inline(n.content);
      if (inner.length) return [paragraph(inner)];
      return blocks(n.content);
    }
  }
}

function blocks(nodes: AdfNode[] | undefined): Doc[] {
  const out: Doc[] = [];
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    out.push(...block(n));
  }
  return out;
}

/** TipTap document for an ADF value, or null when it has no meaningful content. */
export function adfToDocumentJson(node: unknown): TipTapDoc | null {
  if (!node || typeof node !== "object") return null;
  const root = node as AdfNode;
  const content = root.type === "doc" ? blocks(root.content) : blocks([root]);
  const meaningful =
    JSON.stringify(content).includes('"text"') || content.some((c) => c.type === "horizontalRule");
  if (!content.length || !meaningful) return null;
  return { type: "doc", content };
}
