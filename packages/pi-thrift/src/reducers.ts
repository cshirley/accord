/**
 * Structure-aware reducers.
 *
 * Head/tail byte truncation is the crudest way to spend a token budget: it
 * throws away the end of a file to keep the beginning, regardless of which
 * part carries meaning.  These reducers spend the same budget on the parts
 * that survive best.
 *
 *   reduceCode   Keep the declaration skeleton, elide bodies.  A 40KB source
 *                file becomes a few KB that still names every symbol it
 *                defines, and the end of the file survives.
 *   reduceLog    Strip ANSI, fold repeated lines, elide blobs, keep both ends.
 *                Build and test logs are repetitive, their middle is dead
 *                weight, and the tail carries the failure.
 *   reduceList   Listings truncate by entry, not by byte, so the model is told
 *                how many entries it did not see.
 *
 * Every function here is pure and total: given any string it returns a string
 * plus measurements.  No I/O, no config, no globals — this is the testable core.
 */

export interface ReductionResult {
  text: string;
  /** True when the output differs from the input. */
  reduced: boolean;
  originalBytes: number;
  outputBytes: number;
  originalLines: number;
  outputLines: number;
}

const byteLen = (s: string): number => Buffer.byteLength(s, "utf-8");
const lineCount = (s: string): number => (s === "" ? 0 : s.split("\n").length);

function measure(original: string, text: string): ReductionResult {
  return {
    text,
    reduced: text !== original,
    originalBytes: byteLen(original),
    outputBytes: byteLen(text),
    originalLines: lineCount(original),
    outputLines: lineCount(text),
  };
}

// ── Primitives ──────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition.
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><]/g;

/**
 * Remove ANSI colour and cursor escapes. Terminal output is full of them and
 * they are pure noise to a model.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Length above which an unbroken alphanumeric run is assumed to be encoded
 *  data (base64, a hex digest, a data URI) rather than something worth reading. */
const BLOB_MIN_LENGTH = 256;
const BLOB_PATTERN = new RegExp(`[A-Za-z0-9+/=_-]{${BLOB_MIN_LENGTH},}`, "g");

/** Replace long encoded blobs with a marker recording their size. */
export function elideBlobs(text: string): string {
  return text.replace(BLOB_PATTERN, (m) => `[...${m.length} chars of encoded data elided]`);
}

/**
 * Fold three or more consecutive identical lines into one plus a count.
 * Retry loops, progress spam and repeated stack frames collapse hard here.
 */
export function collapseRepeatedLines(text: string, minRun = 3): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run++;

    if (run >= minRun) {
      out.push(line, `[... previous line repeated ${run - 1} more times]`);
    } else {
      for (let k = 0; k < run; k++) out.push(line);
    }
    i += run;
  }

  return out.join("\n");
}

/** Collapse runs of blank lines down to at most `max` consecutive blanks. */
export function collapseBlankRuns(text: string, max = 1): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let blanks = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      blanks++;
      if (blanks <= max) out.push(line);
    } else {
      blanks = 0;
      out.push(line);
    }
  }

  return out.join("\n");
}

/**
 * Keep the first `head` and last `tail` lines, eliding the middle.
 *
 * Preferred over plain head or tail truncation: the two ends of a log hold the
 * invocation and the outcome, and the middle is the region a model attends to
 * least in a long context.
 */
export function headTail(text: string, head: number, tail: number): string {
  const lines = text.split("\n");
  if (lines.length <= head + tail) return text;

  const omitted = lines.length - head - tail;
  return [
    ...lines.slice(0, head),
    `[... ${omitted} lines elided from the middle]`,
    ...lines.slice(lines.length - tail),
  ].join("\n");
}

// ── Code skeleton ───────────────────────────────────────────────────────

/** Strips a leading `123|` or `123<tab>` gutter so classification sees real
 *  code. Some hosts render reads with line numbers; pi does not. Handle both. */
const GUTTER_PATTERN = /^\s*\d+[|\t]/;

/**
 * Lines that declare or export a symbol, open a scope, or carry structural
 * metadata. Deliberately broad — over-keeping costs a few bytes, while dropping
 * a signature the model needed costs a re-read. Covers TS/JS, Python, Go, Rust,
 * Java, C-family, Ruby and shell.
 */
const DECLARATION_PATTERN = new RegExp(
  [
    "^\\s*(?:@|#\\[)",
    "^\\s*#\\s*(?:include|define|pragma)\\b",
    "^\\s*(?:from|import|use|using|require|package|namespace|module|mod)\\b",
    "^\\s*(?:export|declare|default)\\b",
    "^\\s*(?:public|private|protected|internal|static|final|abstract|override|readonly|async|unsafe|extern)\\s+",
    "^\\s*(?:class|interface|struct|enum|trait|impl|type|typedef|union|protocol|extension|record)\\b",
    "^\\s*(?:function|func|fn|def|sub|method|constructor)\\b",
    // No `const`/`let`/`var` rule here on purpose. A top-level binding already
    // qualifies via `structuralIndent`, and matching them at any indent would
    // classify every local variable as structural, leaving bodies intact and
    // the skeleton barely smaller than the original.
    "^\\s*\\w[\\w.<>\\[\\], ]*\\s+\\w+\\s*\\([^;]*\\)\\s*\\{\\s*$",
    "^\\s*\\w+\\s*\\([^;]*\\)\\s*(?:->|:)\\s*\\S+",
    "^\\s*\\w+\\s*:\\s*(?:async\\s+)?(?:function|\\()",
  ].join("|"),
);

/** Documentation comment openers — worth keeping, they explain the symbol that
 *  follows. Ordinary comments inside bodies are not. */
const DOC_COMMENT_PATTERN = /^\s*(?:\/\*\*|\*|\*\/|\/\/\/|"""|'''|#')/;

export interface CodeSkeletonOptions {
  /** Runs of body lines shorter than this are kept verbatim — eliding one or
   *  two lines costs more in marker text than it saves. */
  minRunToElide?: number;
  /** Always keep this many leading lines (licence headers, shebangs). */
  preamble?: number;
  /** Indent width (tab counts as 2) at or below which a line is structural
   *  regardless of content. Catches closing braces and top-level statements. */
  structuralIndent?: number;
}

function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width++;
    else if (ch === "\t") width += 2;
    else break;
  }
  return width;
}

function isStructural(rawLine: string, structuralIndent: number): boolean {
  const line = rawLine.replace(GUTTER_PATTERN, "");
  if (line.trim() === "") return false;
  if (DOC_COMMENT_PATTERN.test(line)) return true;
  if (DECLARATION_PATTERN.test(line)) return true;
  return indentWidth(line) <= structuralIndent;
}

/**
 * Reduce source code to its declaration skeleton.
 *
 * Keeps imports, exports, type and class declarations, function signatures and
 * doc comments; elides the statement bodies between them. The model retains a
 * complete map of what the file defines and where, which is what it needs in
 * order to decide whether to read further.
 */
export function reduceCode(text: string, options: CodeSkeletonOptions = {}): ReductionResult {
  const minRunToElide = options.minRunToElide ?? 3;
  const preamble = options.preamble ?? 0;
  const structuralIndent = options.structuralIndent ?? 0;

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (i < preamble || isStructural(line, structuralIndent)) {
      out.push(line);
      i++;
      continue;
    }

    let run = 0;
    while (i + run < lines.length && !isStructural(lines[i + run] ?? "", structuralIndent)) run++;

    if (run >= minRunToElide) {
      const indent = " ".repeat(indentWidth(lines[i] ?? ""));
      out.push(`${indent}[... ${run} lines elided]`);
    } else {
      for (let k = 0; k < run; k++) out.push(lines[i + k] ?? "");
    }
    i += run;
  }

  return measure(text, collapseBlankRuns(out.join("\n"), 1));
}

// ── Logs and command output ─────────────────────────────────────────────

export interface LogReductionOptions {
  headLines?: number;
  tailLines?: number;
}

/**
 * Reduce command output.
 *
 * Order matters: strip escapes first so repeated lines compare equal, fold
 * repeats before windowing so the window counts distinct lines, and keep a
 * larger tail than head because exit codes, stack traces and failure summaries
 * live at the end.
 */
export function reduceLog(text: string, options: LogReductionOptions = {}): ReductionResult {
  const headLines = options.headLines ?? 40;
  const tailLines = options.tailLines ?? 160;

  let out = stripAnsi(text);
  out = elideBlobs(out);
  out = collapseRepeatedLines(out);
  out = collapseBlankRuns(out, 1);
  out = headTail(out, headLines, tailLines);

  return measure(text, out);
}

// ── Listings ────────────────────────────────────────────────────────────

/**
 * Reduce a listing (grep matches, find results, ls entries) by entry count
 * rather than by byte, so the model is told exactly how many it did not see.
 */
export function reduceList(text: string, maxEntries: number): ReductionResult {
  const lines = text.split("\n");
  if (lines.length <= maxEntries) return measure(text, text);

  const omitted = lines.length - maxEntries;
  const out = [
    ...lines.slice(0, maxEntries),
    `[... ${omitted} more entries (${lines.length} total). Narrow the pattern or path to see the rest]`,
  ].join("\n");

  return measure(text, out);
}

// ── Dispatch ────────────────────────────────────────────────────────────

/** Extensions that `reduceCode` understands well enough to skeletonise.
 *  Anything else falls back to log reduction, which is safe for prose. */
const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "pyi",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cxx",
  "hh",
  "cs",
  "m",
  "mm",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "proto",
  "graphql",
]);

export function looksLikeCode(path: string | undefined): boolean {
  if (path === undefined) return false;
  const ext = path.split(".").pop()?.toLowerCase();
  return ext !== undefined && CODE_EXTENSIONS.has(ext);
}

/**
 * Pick and apply the right reducer for a tool's output.
 *
 * `path` is the file being read, when known — it decides whether code
 * skeletonisation is appropriate.
 */
export function reduceToolOutput(
  toolName: string,
  text: string,
  options: { path?: string; maxEntries?: number } = {},
): ReductionResult {
  switch (toolName) {
    case "read":
      return looksLikeCode(options.path) ? reduceCode(text) : reduceLog(text, { headLines: 120 });
    case "bash":
      return reduceLog(text);
    case "grep":
    case "find":
    case "ls":
      return reduceList(text, options.maxEntries ?? 200);
    default:
      return reduceLog(text);
  }
}
