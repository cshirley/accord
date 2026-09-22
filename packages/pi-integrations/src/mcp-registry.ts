/**
 * MCP Registry — generic MCP client pool driven by mcp.json.
 *
 * Generic pool that can
 * lazily connect to *any* stdio-based MCP server declared in mcp.json.
 *
 * Usage:
 *   const registry = getMcpRegistry();
 *   if (registry.has("atlassian")) {
 *     const result = await registry.call("atlassian", "searchJiraIssuesUsingJql", { jql });
 *   }
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // Fields we read but don't use for stdio spawning
  url?: string;
  directTools?: boolean | string[];
}

interface McpJsonConfig {
  mcpServers: Record<string, ServerConfig>;
}

interface PendingRequest {
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Env variable expansion: "${VAR}" → process.env.VAR
// ---------------------------------------------------------------------------

function expandEnvValue(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });
}

function resolveEnv(declared?: Record<string, string>): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;
  if (!declared) return base;
  for (const [key, value] of Object.entries(declared)) {
    base[key] = expandEnvValue(value);
  }
  return base;
}

// ---------------------------------------------------------------------------
// McpClient — one per server, lazy-started
// ---------------------------------------------------------------------------

const INIT_TIMEOUT_MS = 15_000;
const GRACEFUL_KILL_MS = 3_000;

export class McpClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initialised = false;
  private initPromise: Promise<void> | null = null;
  private dead = false;

  constructor(
    readonly name: string,
    private config: ServerConfig,
    private timeoutMs = 30_000,
  ) {}

  /** Lazy-start the server and complete the MCP initialize handshake. */
  async ensureReady(): Promise<void> {
    if (this.initialised) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._start();
    return this.initPromise;
  }

  get isAlive(): boolean {
    return this.initialised && !this.dead;
  }

  private async _start(): Promise<void> {
    const { command, args = [], env, cwd } = this.config;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (reason: unknown) => {
        if (settled) return;
        settled = true;
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      };

      this.process = spawn(command, args, {
        cwd: cwd ?? undefined,
        stdio: ["pipe", "pipe", "pipe"],
        env: resolveEnv(env),
      });

      this.process.on("error", (err) => {
        this.dead = true;
        finishReject(new Error(`MCP server '${this.name}' failed to start: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        this.dead = true;
        const exitErr = new Error(`MCP server '${this.name}' exited with code ${code}`);
        this.rejectAllPending(exitErr);
        finishReject(exitErr);
      });

      const stdout = this.process.stdout;
      if (!stdout) {
        finishReject(new Error(`MCP server '${this.name}' has no stdout stream`));
        return;
      }
      this.readline = createInterface({ input: stdout });
      this.readline.on("line", (line) => this.handleLine(line));

      // JSON-RPC initialize
      const initId = this.nextId++;
      const initPayload = JSON.stringify({
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pi-api-strategy", version: "1.0.0" },
        },
      });

      const timer = setTimeout(() => {
        this.settlePending(initId);
        finishReject(new Error(`MCP server '${this.name}' initialize timed out`));
      }, INIT_TIMEOUT_MS);

      this.pending.set(initId, {
        settled: false,
        resolve: () => {
          this.settlePending(initId);
          clearTimeout(timer);
          this.initialised = true;

          // Send the required "initialized" notification (no id, no response)
          this.process?.stdin?.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );

          finishResolve();
        },
        reject: (err) => {
          this.settlePending(initId);
          clearTimeout(timer);
          finishReject(err);
        },
        timer,
      });

      this.process.stdin?.write(`${initPayload}\n`);
    });
  }

  /** Call an MCP tool by name. */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    await this.ensureReady();
    if (this.dead) throw new Error(`MCP server '${this.name}' is no longer running`);
    return this.rpc("tools/call", { name: toolName, arguments: args });
  }

  /** Discover tools exposed by this server. */
  async listTools(): Promise<McpToolDef[]> {
    await this.ensureReady();
    if (this.dead) throw new Error(`MCP server '${this.name}' is no longer running`);
    const result = await this.rpc("tools/list", {});
    // tools/list returns { tools: [...] } — extract the array
    const asRecord = result as unknown as Record<string, unknown>;
    return (asRecord.tools as McpToolDef[]) ?? [];
  }

  /** Shut down the child process gracefully, then force-kill after timeout. */
  destroy(): void {
    this.dead = true;
    this.rejectAllPending(new Error(`MCP client '${this.name}' destroyed`));
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.process) {
      const proc = this.process;
      proc.kill("SIGTERM");

      // Force-kill after grace period if still running
      const forceKill = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, GRACEFUL_KILL_MS);

      proc.on("exit", () => clearTimeout(forceKill));
      this.process = null;
    }
  }

  // --- private helpers ---

  private rpc(method: string, params: unknown): Promise<McpToolResult> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<McpToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settlePending(id);
        reject(
          new Error(`MCP call '${method}' on '${this.name}' timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);

      this.pending.set(id, {
        settled: false,
        resolve: (value) => {
          this.settlePending(id);
          resolve(value as McpToolResult);
        },
        reject: (err) => {
          this.settlePending(id);
          reject(err);
        },
        timer,
      });
      this.process?.stdin?.write(`${payload}\n`);
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const id = msg.id;
      if (id == null) return; // notification — ignore

      const pending = this.pending.get(id);
      if (!pending || pending.settled) return;

      if (msg.error) {
        pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        return;
      }

      // Normalise: always resolve as McpToolResult-shaped.
      // Some responses (initialize, tools/list) don't have .content —
      // wrap them so callTool callers never get a non-conforming object.
      const result = msg.result ?? {};
      if (!result.content) {
        if (result.tools !== undefined || result.protocolVersion !== undefined) {
          // Structured response (tools/list, initialize) — resolve raw for listTools()
          pending.resolve(result);
        } else {
          // Unknown shape — wrap as text content
          pending.resolve({
            content: [{ type: "text", text: JSON.stringify(result) }],
          } satisfies McpToolResult);
        }
        return;
      }

      pending.resolve(result);
    } catch {
      // Ignore unparseable lines (stderr leaking, etc.)
    }
  }

  /** Mark a pending request as settled and remove it. */
  private settlePending(id: number): void {
    const pending = this.pending.get(id);
    if (pending) {
      pending.settled = true;
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }
  }

  /** Reject all pending requests that haven't already settled. */
  private rejectAllPending(err: Error): void {
    for (const [_id, pending] of this.pending) {
      if (!pending.settled) {
        pending.settled = true;
        clearTimeout(pending.timer);
        pending.reject(err);
      }
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// McpRegistry — pool of named McpClient instances
// ---------------------------------------------------------------------------

const MCP_CONFIG_PATH = join(homedir(), ".pi", "agent", "mcp.json");

export class McpRegistry {
  private configs: Record<string, ServerConfig> = {};
  private clients = new Map<string, McpClient>();

  constructor(configPath?: string) {
    this.reload(configPath);
  }

  /** (Re)load server definitions from mcp.json. Existing connections are not affected. */
  reload(configPath?: string): void {
    const path = configPath ?? MCP_CONFIG_PATH;
    if (!existsSync(path)) {
      this.configs = {};
      return;
    }
    try {
      const raw: McpJsonConfig = JSON.parse(readFileSync(path, "utf-8"));
      // Only keep stdio-based servers (have `command`, no `url`)
      this.configs = {};
      for (const [name, cfg] of Object.entries(raw.mcpServers ?? {})) {
        if (cfg.command && !cfg.url) {
          this.configs[name] = cfg;
        }
      }
    } catch (err) {
      console.warn(`Failed to load MCP config from ${path}:`, err);
      this.configs = {};
    }
  }

  /** Check whether a server is declared in mcp.json (not necessarily connected). */
  has(serverName: string): boolean {
    return serverName in this.configs;
  }

  /** List all configured server names. */
  serverNames(): string[] {
    return Object.keys(this.configs);
  }

  /** Get or lazily create a client for the given server. */
  getClient(serverName: string): McpClient {
    const existing = this.clients.get(serverName);
    if (existing?.isAlive) return existing;

    const config = this.configs[serverName];
    if (!config) {
      throw new Error(
        `MCP server '${serverName}' not found in mcp.json. Available: ${this.serverNames().join(", ") || "(none)"}`,
      );
    }

    const client = new McpClient(serverName, config);
    this.clients.set(serverName, client);
    return client;
  }

  /** Call a tool on a server (lazy-connects if needed). */
  async call(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolResult> {
    return this.getClient(serverName).callTool(toolName, args);
  }

  /** Destroy a single server's client. */
  destroyClient(serverName: string): void {
    const client = this.clients.get(serverName);
    if (client) {
      client.destroy();
      this.clients.delete(serverName);
    }
  }

  /** Destroy all active clients. */
  destroyAll(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _registry: McpRegistry | null = null;

export function getMcpRegistry(): McpRegistry {
  if (!_registry) {
    _registry = new McpRegistry();
  }
  return _registry;
}

/** Reset the singleton (used on reload / shutdown). */
export function resetMcpRegistry(): void {
  if (_registry) {
    _registry.destroyAll();
    _registry = null;
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Parse text content from an MCP tool result. */
export function mcpText(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/** Parse text content as JSON. */
export function mcpJson<T = unknown>(result: McpToolResult): T {
  const text = mcpText(result);
  return JSON.parse(text);
}
