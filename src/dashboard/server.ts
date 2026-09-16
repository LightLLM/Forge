import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PersistenceStore } from "../persistence/store.js";
import { ApprovalFramework } from "../policy/approval-framework.js";

export interface DashboardServerOptions {
  store: PersistenceStore;
  dbPath: string;
  host?: string;
  port?: number;
}

export interface DashboardHandle {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

/**
 * Lightweight operator dashboard over the same PersistenceStore as the CLI.
 * No duplicated business logic — reads/writes go through store + ApprovalFramework.
 */
export class DashboardServer {
  constructor(private readonly options: DashboardServerOptions) {}

  async start(): Promise<DashboardHandle> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 0;
    const framework = new ApprovalFramework(this.options.dbPath, this.options.store);
    framework.initialize();

    const server = createServer((req, res) => {
      void handleRequest(req, res, this.options.store, framework).catch((err) => {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(port, host, () => resolve());
    });

    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr ? addr.port : (this.options.port ?? 0);
    const url = `http://${host}:${actualPort}`;

    return {
      server,
      url,
      close: async () => {
        framework.close();
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      },
    };
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: PersistenceStore,
  framework: ApprovalFramework,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/tasks") {
    // Store has no listAllTasks — use pending approvals + inspect pattern via events
    const pending = store.listPendingApprovals();
    const taskIds = [...new Set(pending.map((a) => a.taskId))];
    const tasks = taskIds
      .map((id) => store.getTask(id))
      .filter((t): t is NonNullable<typeof t> => t != null)
      .map((t) => ({
        id: t.id,
        objective: t.objective,
        status: t.status,
        updatedAt: t.updatedAt,
      }));
    sendJson(res, 200, { tasks, pendingApprovals: pending.length });
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/tasks/")) {
    const id = url.pathname.slice("/api/tasks/".length);
    const task = store.getTask(id);
    if (!task) {
      sendJson(res, 404, { error: "task not found" });
      return;
    }
    sendJson(res, 200, {
      task,
      approvals: store.listApprovals(id),
      events: store.listEvents(id).slice(-50),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/approvals") {
    const pending = store.listPendingApprovals();
    const restricted = framework.listPending();
    sendJson(res, 200, { pending, restricted });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/api/approvals/") && url.pathname.endsWith("/approve")) {
    const id = url.pathname.slice("/api/approvals/".length, -"/approve".length);
    const updated = store.resolveApproval(id, "approved");
    sendJson(res, 200, { approval: updated });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/api/approvals/") && url.pathname.endsWith("/deny")) {
    const id = url.pathname.slice("/api/approvals/".length, -"/deny".length);
    const updated = store.resolveApproval(id, "denied");
    sendJson(res, 200, { approval: updated });
    return;
  }

  if (
    method === "POST" &&
    url.pathname.startsWith("/api/restricted/") &&
    url.pathname.endsWith("/approve")
  ) {
    const id = url.pathname.slice("/api/restricted/".length, -"/approve".length);
    const body = await readBody(req);
    const maker = (body.decisionMaker as string) || "operator";
    const updated = framework.resolve(id, "approved", maker);
    sendJson(res, 200, { approval: updated });
    return;
  }

  if (
    method === "POST" &&
    url.pathname.startsWith("/api/restricted/") &&
    url.pathname.endsWith("/deny")
  ) {
    const id = url.pathname.slice("/api/restricted/".length, -"/deny".length);
    const body = await readBody(req);
    const maker = (body.decisionMaker as string) || "operator";
    const updated = framework.resolve(id, "denied", maker);
    sendJson(res, 200, { approval: updated });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Forge Operator</title>
  <style>
    :root { color-scheme: light; --ink:#1a1a1a; --muted:#5c5c5c; --line:#ddd; --ok:#0a7; --bad:#c33; }
    body { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; margin: 0; background:
      radial-gradient(1200px 600px at 10% -10%, #e8f2ff, transparent),
      linear-gradient(180deg, #f7f5f2, #efeae3); color: var(--ink); }
    header { padding: 1.5rem 2rem; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; }
    p { color: var(--muted); margin: 0.35rem 0 0; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; padding: 1.5rem 2rem; }
    section { min-height: 12rem; }
    h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .row { padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
    button { margin-right: 0.5rem; padding: 0.35rem 0.7rem; border: 1px solid var(--line); background: #fff; cursor: pointer; }
    .ok { color: var(--ok); } .bad { color: var(--bad); }
    @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Forge</h1>
    <p>Operator dashboard — same backend as CLI</p>
  </header>
  <main>
    <section>
      <h2>Tasks</h2>
      <div id="tasks"></div>
    </section>
    <section>
      <h2>Approvals</h2>
      <div id="approvals"></div>
    </section>
  </main>
  <script>
    async function refresh() {
      const [t, a] = await Promise.all([
        fetch("/api/tasks").then(r => r.json()),
        fetch("/api/approvals").then(r => r.json()),
      ]);
      document.getElementById("tasks").innerHTML = (t.tasks || []).map(x =>
        \`<div class="row"><strong>\${x.id.slice(0,8)}</strong> \${x.status}<br/><span>\${x.objective}</span></div>\`
      ).join("") || "<div class='row'>No tasks with pending approvals</div>";
      document.getElementById("approvals").innerHTML = (a.pending || []).map(x =>
        \`<div class="row"><code>\${x.id.slice(0,8)}</code> \${x.action}<br/>\${x.reason || ""}
          <div><button onclick="act('\${x.id}','approve')">Approve</button>
          <button onclick="act('\${x.id}','deny')">Deny</button></div></div>\`
      ).join("") || "<div class='row'>No pending approvals</div>";
    }
    async function act(id, kind) {
      await fetch("/api/approvals/" + id + "/" + kind, { method: "POST" });
      refresh();
    }
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>
`;
