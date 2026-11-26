/**
 * Lightweight HTML → Markdown converter tuned for Google Docs HTML export.
 */

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function _stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function isBoldTag(tag: string): boolean {
  return /<(b|strong)\b/i.test(tag) || /font-weight:\s*(bold|[6-9]00)/i.test(tag);
}

function isItalicTag(tag: string): boolean {
  return /<(i|em)\b/i.test(tag) || /font-style:\s*italic/i.test(tag);
}

function isStrikeTag(tag: string): boolean {
  return /<(s|strike|del)\b/i.test(tag) || /text-decoration:\s*line-through/i.test(tag);
}

function isCodeTag(tag: string): boolean {
  return /<(code|pre)\b/i.test(tag) || /font-family:\s*[^;]*monospace/i.test(tag);
}

function headingLevel(tag: string): number | null {
  const m = tag.match(/^<h([1-6])\b/i);
  return m ? Number(m[1]) : null;
}

function listKind(tag: string): "ul" | "ol" | null {
  if (/^<ul\b/i.test(tag)) return "ul";
  if (/^<ol\b/i.test(tag)) return "ol";
  return null;
}

function extractHref(tag: string): string | null {
  const m = tag.match(/\bhref=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}

function inlineToMarkdown(html: string): string {
  let out = "";
  let i = 0;
  const stack: Array<"bold" | "italic" | "strike" | "code" | "link"> = [];
  let linkUrl = "";

  while (i < html.length) {
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const chunk = decodeEntities(html.slice(i, next === -1 ? undefined : next));
      out += chunk;
      i = next === -1 ? html.length : next;
      continue;
    }

    const close = html.indexOf(">", i);
    if (close === -1) break;
    const tag = html.slice(i, close + 1);
    const isClosing = /^<\//.test(tag);
    const tagName =
      tag
        .replace(/^<\/?\s*|\s*\/?>$/g, "")
        .split(/\s/)[0]
        ?.toLowerCase() ?? "";

    if (isClosing) {
      if (tagName === "a" && stack[stack.length - 1] === "link") {
        stack.pop();
        out += `](${linkUrl})`;
        linkUrl = "";
      } else if (tagName === "b" || tagName === "strong") {
        if (stack[stack.length - 1] === "bold") {
          stack.pop();
          out += "**";
        }
      } else if (tagName === "i" || tagName === "em") {
        if (stack[stack.length - 1] === "italic") {
          stack.pop();
          out += "*";
        }
      } else if (tagName === "s" || tagName === "strike" || tagName === "del") {
        if (stack[stack.length - 1] === "strike") {
          stack.pop();
          out += "~~";
        }
      } else if (tagName === "code") {
        if (stack[stack.length - 1] === "code") {
          stack.pop();
          out += "`";
        }
      } else if (tagName === "br") {
        out += "\n";
      }
      i = close + 1;
      continue;
    }

    if (/^<br\b/i.test(tag)) {
      out += "\n";
      i = close + 1;
      continue;
    }

    const href = extractHref(tag);
    if (href && /^<a\b/i.test(tag)) {
      stack.push("link");
      linkUrl = href;
      out += "[";
      i = close + 1;
      continue;
    }

    if (isBoldTag(tag)) {
      stack.push("bold");
      out += "**";
    } else if (isItalicTag(tag)) {
      stack.push("italic");
      out += "*";
    } else if (isStrikeTag(tag)) {
      stack.push("strike");
      out += "~~";
    } else if (isCodeTag(tag)) {
      stack.push("code");
      out += "`";
    }

    i = close + 1;
  }

  while (stack.length) {
    const top = stack.pop();
    if (top === "bold") out += "**";
    else if (top === "italic") out += "*";
    else if (top === "strike") out += "~~";
    else if (top === "code") out += "`";
    else if (top === "link") out += `](${linkUrl})`;
  }

  return out.replace(/[ \t]+\n/g, "\n").trim();
}

function blockToMarkdown(html: string, listDepth = 0, orderedIndex = 1): string {
  const trimmed = html.trim();
  if (!trimmed) return "";

  const heading = headingLevel(trimmed.match(/^<[^>]+>/)?.[0] ?? "");
  if (heading) {
    const inner = trimmed.replace(/^<h[1-6][^>]*>/i, "").replace(/<\/h[1-6]>\s*$/i, "");
    return `${"#".repeat(heading)} ${inlineToMarkdown(inner)}\n`;
  }

  const listType = listKind(trimmed.match(/^<[^>]+>/)?.[0] ?? "");
  if (listType) {
    const items = [...trimmed.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    const indent = "  ".repeat(listDepth);
    return items
      .map((item, idx) => {
        const bullet = listType === "ol" ? `${idx + 1}.` : "-";
        const body =
          blockToMarkdown(item[1] ?? "", listDepth + 1).trim() || inlineToMarkdown(item[1] ?? "");
        const lines = body.split("\n");
        const first = `${indent}${bullet} ${lines[0] ?? ""}`;
        const rest = lines
          .slice(1)
          .map((l) => `${indent}  ${l}`)
          .join("\n");
        return rest ? `${first}\n${rest}` : first;
      })
      .join("\n");
  }

  if (/^<table\b/i.test(trimmed)) {
    const rows = [...trimmed.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const mdRows = rows.map((row) => {
      const cells = [...(row[1]?.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [])].map((c) =>
        inlineToMarkdown(c[1] ?? "")
          .replace(/\|/g, "\\|")
          .replace(/\n/g, " "),
      );
      return `| ${cells.join(" | ")} |`;
    });
    if (mdRows.length >= 2) {
      const sep = `| ${mdRows[0]
        .slice(1, -1)
        .split("|")
        .map(() => "---")
        .join(" | ")} |`;
      return [mdRows[0], sep, ...mdRows.slice(1)].join("\n");
    }
    return mdRows.join("\n");
  }

  if (/^<p\b/i.test(trimmed)) {
    const inner = trimmed.replace(/^<p[^>]*>/i, "").replace(/<\/p>\s*$/i, "");
    const text = inlineToMarkdown(inner);
    return text ? `${text}\n` : "";
  }

  if (/^<div\b/i.test(trimmed)) {
    const inner = trimmed.replace(/^<div[^>]*>/i, "").replace(/<\/div>\s*$/i, "");
    return blockToMarkdown(inner, listDepth, orderedIndex);
  }

  return `${inlineToMarkdown(trimmed)}\n`;
}

export function htmlToMarkdown(html: string): string {
  const cleaned = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n");

  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? cleaned;

  const blocks = body
    .split(/(?=<(?:h[1-6]|p|ul|ol|table|div)\b)/i)
    .map((b) => blockToMarkdown(b).trimEnd())
    .filter(Boolean);

  const markdown = blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return markdown ? `${markdown}\n` : "";
}

export function plainTextToMarkdown(text: string): { title?: string; markdown: string } {
  const titleMatch = text.match(/^Document Title:\s*(.+?)(?:\n\n|\n$)/);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    const body = text.slice(titleMatch[0].length).trim();
    return {
      title,
      markdown: body ? `# ${title}\n\n${body}\n` : `# ${title}\n`,
    };
  }

  try {
    const parsed = JSON.parse(text) as {
      title?: string;
      tabs?: Array<{ title?: string; content?: string }>;
    };
    if (parsed.tabs?.length) {
      const sections = parsed.tabs.map((tab) => {
        const heading = tab.title ? `## ${tab.title}` : "";
        const content = (tab.content ?? "").trim();
        return [heading, content].filter(Boolean).join("\n\n");
      });
      const title = parsed.title ? `# ${parsed.title}\n\n` : "";
      return { title: parsed.title, markdown: `${title}${sections.join("\n\n")}\n` };
    }
    if (parsed.title) {
      return { title: parsed.title, markdown: `# ${parsed.title}\n` };
    }
  } catch {
    /* plain text */
  }

  const trimmed = text.trim();
  return { markdown: trimmed ? `${trimmed}\n` : "" };
}
