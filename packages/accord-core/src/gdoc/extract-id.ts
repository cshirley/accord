const DOC_ID_REGEX = /\/d\/([a-zA-Z0-9_-]+)/;
const ID_ONLY_REGEX = /^[a-zA-Z0-9_-]{20,}$/;

/** Extract a Google Doc ID from a URL or bare ID string. */
export function extractDocumentId(urlOrId: string): string {
  const input = urlOrId.trim();
  if (!input) throw new Error("Document URL or ID is required");

  if (ID_ONLY_REGEX.test(input)) return input;

  const match = input.match(DOC_ID_REGEX);
  if (match?.[1]) return match[1];

  throw new Error(`Invalid Google Doc URL or ID: ${input}`);
}

export function sanitizeFilename(name: string): string {
  return (
    name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control chars from filenames
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "untitled"
  );
}
