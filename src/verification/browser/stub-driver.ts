import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserDriver } from "./types.js";

/**
 * Deterministic in-process browser stub for CI/gate tests.
 * Supports navigate/type/click against a tiny form-capable HTTP page.
 */
export class StubBrowserDriver implements BrowserDriver {
  readonly name = "stub";
  private baseUrl = "";
  private currentUrl = "";
  private html = "";
  private fields = new Map<string, string>();
  private readonly consoles: string[] = [];
  private readonly networks: string[] = [];
  private server: Server | null = null;
  private ownsServer = false;

  async start(options: {
    baseUrl: string;
    viewport?: { width: number; height: number };
    artifactDir: string;
  }): Promise<void> {
    mkdirSync(options.artifactDir, { recursive: true });
    if (options.baseUrl.startsWith("http://") || options.baseUrl.startsWith("https://")) {
      this.baseUrl = options.baseUrl.replace(/\/$/, "");
      return;
    }
    await this.startLocalFixture();
  }

  /** Start the built-in login fixture server (used by tests). */
  async startLocalFixture(): Promise<string> {
    if (this.server) return this.baseUrl;
    this.ownsServer = true;
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  async navigate(url: string): Promise<void> {
    const abs = url.startsWith("http")
      ? url
      : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    const res = await fetch(abs);
    this.html = await res.text();
    this.currentUrl = abs;
    if (!res.ok) this.networks.push(`${res.status} ${abs}`);
  }

  async click(selector: string): Promise<void> {
    if (
      selector === "button[type=submit]" ||
      selector === "#login-btn" ||
      selector.includes("submit")
    ) {
      const user =
        this.fields.get("#username") ??
        this.fields.get("input[name=username]") ??
        "";
      const pass =
        this.fields.get("#password") ??
        this.fields.get("input[name=password]") ??
        "";
      const res = await fetch(`${this.baseUrl}/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
        redirect: "follow",
      });
      this.html = await res.text();
      this.currentUrl = res.url;
      if (!res.ok) this.networks.push(`${res.status} ${res.url}`);
      return;
    }
    throw new Error(`StubDriver cannot click selector: ${selector}`);
  }

  async type(selector: string, text: string): Promise<void> {
    this.fields.set(selector, text);
  }

  async textContent(): Promise<string> {
    return this.html.replace(/<[^>]+>/g, " ");
  }

  async url(): Promise<string> {
    return this.currentUrl;
  }

  async screenshot(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(path, png);
  }

  consoleErrors(): string[] {
    return [...this.consoles];
  }

  networkFailures(): string[] {
    return [...this.networks];
  }

  async close(): Promise<void> {
    if (this.ownsServer && this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
      this.ownsServer = false;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url === "/login")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(LOGIN_HTML);
      return;
    }
    if (req.method === "POST" && url === "/login") {
      let body = "";
      req.on("data", (c) => {
        body += c.toString("utf8");
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const user = params.get("username") ?? "";
        const pass = params.get("password") ?? "";
        if (user === "demo" && pass === "demo") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(SUCCESS_HTML);
        } else {
          res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
          res.end(FAIL_HTML);
        }
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  }
}

const LOGIN_HTML = `<!doctype html>
<html><head><title>Login</title></head>
<body>
  <h1>Sign in</h1>
  <form method="POST" action="/login">
    <label>Username <input id="username" name="username" /></label>
    <label>Password <input id="password" name="password" type="password" /></label>
    <button id="login-btn" type="submit">Log in</button>
  </form>
</body></html>`;

const SUCCESS_HTML = `<!doctype html>
<html><head><title>Home</title></head>
<body>
  <h1>Welcome</h1>
  <p data-testid="status">Login successful</p>
</body></html>`;

const FAIL_HTML = `<!doctype html>
<html><head><title>Login</title></head>
<body>
  <h1>Sign in</h1>
  <p data-testid="status">Invalid credentials</p>
</body></html>`;
