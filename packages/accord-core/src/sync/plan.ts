/**
 * Plan + apply for `accord-sync`. Idempotent; never overwrites real files or
 * foreign symlinks; generated files are replaced only if they carry our marker.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  findPiOnlyRefs,
  GENERATED_MARKER,
  type PiMcpServer,
  parsePiAgent,
  toClaudeAgent,
  toClaudeMcp,
  toCodexToml,
} from "./convert.js";

export type SyncAction =
  | { kind: "link"; from: string; to: string }
  | { kind: "write"; path: string; content: string; mode?: number }
  | { kind: "skip"; path: string; reason: string }
  | { kind: "warn"; path: string; reason: string };

export type SyncInputs = {
  home: string;
  /** Extra skill source dirs (each holds <skill>/SKILL.md), e.g. pi skills + accord pi-skills. */
  skillSources: string[];
  /**
   * Also link sources into ~/.agents/skills (Codex reads it natively). Off by default:
   * pi also scans that dir, so it would see each skill twice and log name collisions.
   */
  codex?: boolean;
};

function dirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(root, e.name, "SKILL.md")),
    )
    .map((e) => e.name);
}

function linkAction(from: string, to: string): SyncAction {
  try {
    const st = lstatSync(to);
    if (st.isSymbolicLink() && readlinkSync(to) === from)
      return { kind: "skip", path: to, reason: "already linked" };
    return {
      kind: "skip",
      path: to,
      reason: st.isSymbolicLink() ? "foreign symlink" : "exists (not a symlink)",
    };
  } catch {
    return { kind: "link", from, to };
  }
}

export function planSync(input: SyncInputs): SyncAction[] {
  const { home } = input;
  const actions: SyncAction[] = [];
  const canonical = join(home, ".agents", "skills");
  const claudeSkills = join(home, ".claude", "skills");

  // 1. Skills: sources → Claude Code directly (and ~/.agents/skills when `codex`)
  const seen = new Set<string>();
  for (const src of input.skillSources) {
    for (const name of dirs(src)) {
      const md = readFileSync(join(src, name, "SKILL.md"), "utf8");
      const refs = findPiOnlyRefs(md);
      if (refs.length)
        actions.push({
          kind: "warn",
          path: join(src, name, "SKILL.md"),
          reason: `pi-only tool refs: ${refs.join(", ")}`,
        });
      if (seen.has(name)) {
        actions.push({
          kind: "skip",
          path: join(src, name),
          reason: "duplicate skill name (earlier source wins)",
        });
        continue;
      }
      seen.add(name);
      actions.push(linkAction(join(src, name), join(claudeSkills, name)));
      if (input.codex) actions.push(linkAction(join(src, name), join(canonical, name)));
    }
  }
  // 2. Skills already canonical in ~/.agents/skills → Claude Code
  for (const name of dirs(canonical)
    .filter((n) => !seen.has(n))
    .sort())
    actions.push(linkAction(join(canonical, name), join(claudeSkills, name)));

  // 3. Subagents: pi agents/*.md → ~/.claude/agents
  const piAgents = join(home, ".config", "pi", "agent", "agents");
  if (existsSync(piAgents)) {
    for (const f of readdirSync(piAgents).filter((n) => n.endsWith(".md"))) {
      const agent = parsePiAgent(readFileSync(join(piAgents, f), "utf8"));
      const target = join(home, ".claude", "agents", f);
      if (!agent) {
        actions.push({ kind: "warn", path: join(piAgents, f), reason: "no parsable frontmatter" });
        continue;
      }
      if (existsSync(target) && !readFileSync(target, "utf8").includes(GENERATED_MARKER)) {
        actions.push({ kind: "skip", path: target, reason: "exists (not generated)" });
        continue;
      }
      actions.push({ kind: "write", path: target, content: toClaudeAgent(agent) });
    }
  }

  // 4. MCP: pi mcp.json → generated Claude + Codex snippets (never edits ~/.claude.json)
  const mcpPath = join(home, ".config", "pi", "agent", "mcp.json");
  if (existsSync(mcpPath)) {
    const servers = (JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers ?? {}) as Record<
      string,
      PiMcpServer
    >;
    const gen = join(home, ".agents", "generated");
    actions.push({
      kind: "write",
      path: join(gen, "mcp.claude.json"),
      content: `${JSON.stringify(toClaudeMcp(servers), null, 2)}\n`,
      mode: 0o600,
    });
    actions.push({
      kind: "write",
      path: join(gen, "mcp.codex.toml"),
      content: toCodexToml(servers),
      mode: 0o600,
    });
  }
  return actions;
}

export function applySync(actions: SyncAction[]): void {
  for (const a of actions) {
    if (a.kind === "link") {
      mkdirSync(join(a.to, ".."), { recursive: true });
      symlinkSync(a.from, a.to);
    } else if (a.kind === "write") {
      mkdirSync(join(a.path, ".."), { recursive: true });
      writeFileSync(a.path, a.content, { mode: a.mode ?? 0o644 });
    }
  }
}
