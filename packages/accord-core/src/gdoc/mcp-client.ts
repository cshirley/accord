/**
 * Minimal MCP stdio client — reuses google-workspace server config from mcp.json.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpServerCfg {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function readMcpServer(name: string): McpServerCfg | null {
  const candidates = [
    join(homedir(), ".config", "pi", "agent", "mcp.json"),
    join(homedir(), ".pi", "agent", "mcp.json"),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const cfg = JSON.parse(readFileSync(p, "utf-8")) as {
        mcpServers?: Record<string, McpServerCfg & { disabled?: boolean }>;
      };
      const s = cfg.mcpServers?.[name];
      if (s?.disabled) return null;
      if (s?.command && Array.isArray(s.args)) {
        return { command: s.command, args: s.args, env: s.env };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

interface McpRpcMessage {
  id?: number | string;
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
}

export class McpStdioClient {
  private child: ReturnType<typeof spawn>;
  private buf = "";
  private pending = new Map<number, (m: McpRpcMessage) => void>();
  private nextId = 1;

  constructor(cfg: McpServerCfg) {
    this.child = spawn(cfg.command, cfg.args, {
      env: { ...process.env, ...(cfg.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.on("error", () => {});
    this.child.stdout?.on("data", (d: Buffer) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buf += d.toString();
    for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: McpRpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id as number)) {
        const resolve = this.pending.get(msg.id as number);
        this.pending.delete(msg.id as number);
        resolve?.(msg);
      }
    }
  }

  private request(method: string, params: unknown, timeoutMs = 60000): Promise<McpRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(clientName = "google-doc-markdown"): Promise<void> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: clientName, version: "1" },
      },
      20000,
    );
    this.notify("notifications/initialized", {});
  }

  async callText(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.error) throw new Error(r.error.message || `MCP error: ${name}`);
    if (r.result?.isError) {
      const errText = (r.result?.content || []).map((c) => c.text || "").join("");
      throw new Error(`MCP tool error: ${name}${errText ? ` — ${errText}` : ""}`);
    }
    return (r.result?.content || []).map((c) => c.text || "").join("");
  }

  close(): void {
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

export async function withMcpClient<T>(
  fn: (client: McpStdioClient) => Promise<T>,
  serverName = "google-workspace",
): Promise<T> {
  const cfg = readMcpServer(serverName);
  if (!cfg) {
    throw new Error(
      `MCP server "${serverName}" not configured. Add it to ~/.pi/agent/mcp.json and authenticate.`,
    );
  }
  const client = new McpStdioClient(cfg);
  try {
    await client.initialize();
    return await fn(client);
  } finally {
    client.close();
  }
}
