import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpCallResult, McpClient, McpToolDescriptor } from "./types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
}

export interface StdioMcpClientOptions {
  serverId: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Minimal MCP client over stdio (initialize + tools/list + tools/call).
 * Intentionally small — no full SDK dependency.
 */
export class StdioMcpClient implements McpClient {
  readonly serverId: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly timeoutMs: number;
  private readonly options: StdioMcpClientOptions;
  private closed = false;

  constructor(options: StdioMcpClientOptions) {
    this.options = options;
    this.serverId = options.serverId;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => this.onLine(line));
    child.stderr.on("data", () => {
      // Ignore server logs; do not treat as protocol.
    });
    child.on("error", (err) => {
      this.failAll(err);
    });
    child.on("exit", (code) => {
      this.failAll(new Error(`MCP server '${this.serverId}' exited (code ${code})`));
      this.child = null;
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "forge", version: "0.6.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.connect();
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.connect();
    const raw = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const obj = raw as { content?: unknown; isError?: boolean };
    return {
      content: obj.content ?? raw,
      isError: Boolean(obj.isError),
      raw,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("MCP client closed"));
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.kill();
  }

  private notify(method: string, params: unknown): void {
    if (!this.child?.stdin.writable) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.child.stdin.write(`${msg}\n`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error(`MCP server '${this.serverId}' is not connected`));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      return;
    }
    if (msg.id == null || typeof msg.id === "object") return;
    const id = Number(msg.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (msg.error) {
      pending.reject(
        new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
