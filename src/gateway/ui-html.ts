/** Forge operator web GUI — vanilla SPA served by Gateway (127.0.0.1). */
export const FORGE_GUI_HTML = `<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Forge</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg:#0f1216; --panel:#161b22; --line:#2a3340; --text:#e6edf3; --muted:#8b9bb0;
  --accent:#3d9cf0; --ok:#3dd68c; --bad:#f07178; --warn:#e6b450; --chip:#1e2630;
  --radius:8px; --font: "IBM Plex Sans", "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
html[data-theme="light"] {
  --bg:#f4f6f8; --panel:#ffffff; --line:#d8dee6; --text:#1a2332; --muted:#5c6b7a;
  --accent:#0066cc; --ok:#0a7a45; --bad:#c0392b; --warn:#a66a00; --chip:#eef2f6;
}
@media (prefers-color-scheme: light) {
  html[data-theme="system"] {
    --bg:#f4f6f8; --panel:#ffffff; --line:#d8dee6; --text:#1a2332; --muted:#5c6b7a;
    --accent:#0066cc; --ok:#0a7a45; --bad:#c0392b; --warn:#a66a00; --chip:#eef2f6;
  }
}
* { box-sizing:border-box; }
body { margin:0; font-family:var(--font); background:var(--bg); color:var(--text); height:100vh; overflow:hidden; }
button, input, select, textarea { font:inherit; color:inherit; }
#app { display:grid; grid-template-rows:48px 1fr; height:100vh; }
header {
  display:flex; align-items:center; gap:1rem; padding:0 1rem;
  border-bottom:1px solid var(--line); background:var(--panel);
}
.brand { font-weight:600; letter-spacing:-0.02em; font-size:1.05rem; }
.pill { font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px; background:var(--chip); color:var(--muted); border:1px solid var(--line); }
.pill.online { color:var(--ok); }
main { display:grid; grid-template-columns:200px 1fr 300px; min-height:0; }
nav { border-right:1px solid var(--line); background:var(--panel); padding:0.75rem 0.5rem; overflow:auto; }
nav button {
  display:block; width:100%; text-align:left; background:transparent; border:0;
  padding:0.55rem 0.7rem; border-radius:var(--radius); color:var(--muted); cursor:pointer;
}
nav button.active, nav button:hover { background:var(--chip); color:var(--text); }
#center { display:grid; grid-template-rows:auto 1fr auto; min-height:0; }
#right { border-left:1px solid var(--line); background:var(--panel); display:grid; grid-template-rows:auto 1fr; min-height:0; }
.panel-title { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); padding:0.75rem 1rem 0.35rem; }
#chat { overflow:auto; padding:1rem; }
.msg { margin:0 0 0.85rem; max-width:48rem; }
.msg .who { font-size:0.75rem; color:var(--muted); margin-bottom:0.2rem; font-family:var(--mono); }
.msg .body { white-space:pre-wrap; line-height:1.45; }
.msg.event .body { color:var(--muted); font-family:var(--mono); font-size:0.85rem; }
#composer { border-top:1px solid var(--line); padding:0.75rem; background:var(--panel); }
.modes { display:flex; gap:0.35rem; margin-bottom:0.5rem; flex-wrap:wrap; }
.modes button {
  border:1px solid var(--line); background:var(--chip); border-radius:999px;
  padding:0.25rem 0.65rem; font-size:0.75rem; cursor:pointer;
}
.modes button.active { border-color:var(--accent); color:var(--accent); }
.row { display:flex; gap:0.5rem; }
textarea {
  flex:1; min-height:64px; max-height:180px; resize:vertical;
  background:var(--bg); border:1px solid var(--line); border-radius:var(--radius); padding:0.6rem 0.75rem;
}
#send {
  background:var(--accent); color:#fff; border:0; border-radius:var(--radius);
  padding:0 1rem; cursor:pointer; font-weight:500;
}
#live { overflow:auto; padding:0.5rem 1rem 1rem; font-family:var(--mono); font-size:0.78rem; }
.live-item { padding:0.35rem 0; border-bottom:1px solid var(--line); color:var(--muted); }
.live-item strong { color:var(--text); font-weight:500; }
.view { display:none; padding:1rem; overflow:auto; }
.view.active { display:block; }
#center-views { display:none; overflow:auto; }
#center-views.active { display:block; }
table { width:100%; border-collapse:collapse; font-size:0.9rem; }
td, th { text-align:left; padding:0.45rem 0.35rem; border-bottom:1px solid var(--line); }
.actions button { margin-right:0.35rem; padding:0.25rem 0.55rem; border:1px solid var(--line); background:var(--chip); border-radius:4px; cursor:pointer; }
.actions .ok { border-color:var(--ok); color:var(--ok); }
.actions .bad { border-color:var(--bad); color:var(--bad); }
#mobile-tabs { display:none; }
#palette {
  display:none; position:fixed; inset:0; background:rgba(0,0,0,.45);
  align-items:flex-start; justify-content:center; padding-top:12vh; z-index:50;
}
#palette.open { display:flex; }
#palette .box {
  width:min(520px,92vw); background:var(--panel); border:1px solid var(--line);
  border-radius:12px; overflow:hidden; box-shadow:0 16px 48px rgba(0,0,0,.35);
}
#palette input {
  width:100%; border:0; border-bottom:1px solid var(--line); background:transparent;
  padding:0.9rem 1rem; outline:none;
}
#palette .items button {
  display:block; width:100%; text-align:left; border:0; background:transparent;
  padding:0.7rem 1rem; cursor:pointer; color:var(--text);
}
#palette .items button:hover { background:var(--chip); }
@media (max-width: 900px) {
  main { grid-template-columns:1fr; grid-template-rows:1fr auto; }
  nav, #right { display:none; }
  nav.mobile-open, #right.mobile-open { display:block; position:fixed; inset:48px 0 56px 0; z-index:20; }
  #mobile-tabs {
    display:flex; position:fixed; bottom:0; left:0; right:0; height:56px;
    border-top:1px solid var(--line); background:var(--panel);
  }
  #mobile-tabs button { flex:1; border:0; background:transparent; color:var(--muted); }
  #mobile-tabs button.active { color:var(--accent); }
}
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="brand">FORGE</div>
    <span class="pill" id="projectPill">project</span>
    <span class="pill" id="modePill">local-preferred</span>
    <span class="pill online" id="onlinePill">● ONLINE</span>
    <span style="flex:1"></span>
    <button class="pill" id="themeBtn" title="Theme">Theme</button>
    <button class="pill" id="paletteBtn" title="Command palette (Ctrl/Cmd+K)">⌘K</button>
  </header>
  <main>
    <nav id="nav">
      <button data-view="chat" class="active">Chat</button>
      <button data-view="sessions">Sessions</button>
      <button data-view="tasks">Tasks</button>
      <button data-view="approvals">Approvals</button>
      <button data-view="pairings">Pairings</button>
      <button data-view="memory">Memory</button>
      <button data-view="skills">Skills</button>
      <button data-view="models">Models</button>
      <button data-view="gateway">Gateway</button>
      <button data-view="settings">Settings</button>
    </nav>
    <section id="center">
      <div class="panel-title">Agent chat · mode enforced by policy</div>
      <div id="chat"></div>
      <div id="composer">
        <div class="modes" id="modes">
          <button data-mode="ask">ASK</button>
          <button data-mode="plan">PLAN</button>
          <button data-mode="build" class="active">BUILD</button>
          <button data-mode="debug">DEBUG</button>
          <button data-mode="review">REVIEW</button>
        </div>
        <div class="row">
          <textarea id="input" placeholder="Describe an engineering objective… (@file coming soon)"></textarea>
          <button id="send">Send</button>
        </div>
      </div>
    </section>
    <aside id="right">
      <div class="panel-title">Live run</div>
      <div id="live"></div>
    </aside>
  </main>
  <div id="center-views">
    <div class="view" id="view-sessions"></div>
    <div class="view" id="view-tasks"></div>
    <div class="view" id="view-approvals"></div>
    <div class="view" id="view-pairings"></div>
    <div class="view" id="view-memory"></div>
    <div class="view" id="view-skills"></div>
    <div class="view" id="view-models"></div>
    <div class="view" id="view-gateway"></div>
    <div class="view" id="view-settings"><p>Bound to <code>127.0.0.1</code> by default. Secrets never leave the server env.</p></div>
  </div>
</div>
<div id="mobile-tabs">
  <button data-mobile="chat" class="active">Chat</button>
  <button data-mobile="tasks">Tasks</button>
  <button data-mobile="approvals">Approvals</button>
</div>
<div id="palette"><div class="box"><input id="paletteInput" placeholder="Type a command…"/><div class="items" id="paletteItems"></div></div></div>
<script>
const state = {
  sessionId: null,
  mode: "build",
  theme: localStorage.getItem("forge-theme") || "system",
};
const $ = (s) => document.querySelector(s);
const chat = $("#chat");
const live = $("#live");

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
}
applyTheme();

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts?.headers||{}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : res.statusText);
  return data;
}

function addChat(who, body, cls="") {
  const el = document.createElement("div");
  el.className = "msg " + cls;
  el.innerHTML = '<div class="who"></div><div class="body"></div>';
  el.querySelector(".who").textContent = who;
  el.querySelector(".body").textContent = body;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function addLive(type, payload) {
  const el = document.createElement("div");
  el.className = "live-item";
  const t = new Date().toLocaleTimeString();
  el.innerHTML = '<strong></strong> <span></span>';
  el.querySelector("strong").textContent = t + " " + type;
  el.querySelector("span").textContent = typeof payload === "string" ? payload : JSON.stringify(payload).slice(0, 120);
  live.prepend(el);
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const status = await api("/api/system/status");
  $("#projectPill").textContent = (status.workspacePath || "").split(/[/\\\\]/).pop() || "project";
  $("#modePill").textContent = status.mode || "local-preferred";
  const created = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspacePath: status.workspacePath,
      channel: "web",
      chatMode: state.mode,
      title: "Web session",
    }),
  });
  state.sessionId = created.session.id;
  addChat("system", "Session " + state.sessionId.slice(0,8) + " ready · " + status.bindHint, "event");
  return state.sessionId;
}

async function refreshMessages() {
  if (!state.sessionId) return;
  const data = await api("/api/sessions/" + state.sessionId + "/messages");
  chat.innerHTML = "";
  for (const m of data.messages || []) {
    addChat(m.role, m.content?.text || "", m.role === "event" ? "event" : "");
  }
}

async function sendMessage() {
  const text = $("#input").value.trim();
  if (!text) return;
  $("#input").value = "";
  await ensureSession();
  addChat("you", text);
  const result = await api("/api/sessions/" + state.sessionId + "/messages", {
    method: "POST",
    body: JSON.stringify({ content: text, mode: state.mode }),
  });
  if (result.message?.content?.text) addChat("forge", result.message.content.text);
}

function showView(name) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "chat") {
    $("#center").style.display = "grid";
    $("#center-views").classList.remove("active");
    document.querySelectorAll("#center-views .view").forEach((v) => v.classList.remove("active"));
    return;
  }
  $("#center").style.display = "none";
  $("#center-views").classList.add("active");
  document.querySelectorAll("#center-views .view").forEach((v) => {
    v.classList.toggle("active", v.id === "view-" + name);
  });
  loadView(name);
}

async function loadView(name) {
  const el = $("#view-" + name);
  if (!el) return;
  if (name === "sessions") {
    const data = await api("/api/sessions");
    el.innerHTML = "<h3>Sessions</h3><table><tr><th>Id</th><th>Channel</th><th>Mode</th><th>Title</th></tr>" +
      (data.sessions||[]).map(s => '<tr><td>'+s.id.slice(0,8)+'</td><td>'+s.channel+'</td><td>'+s.chatMode+'</td><td>'+escapeHtml(s.title)+'</td></tr>').join("") + "</table>";
  } else if (name === "approvals") {
    const data = await api("/api/approvals");
    el.innerHTML = "<h3>Approvals</h3>" + ((data.pending||[]).map(a =>
      '<div style="margin:0.75rem 0;padding:0.75rem;border:1px solid var(--line);border-radius:8px">' +
      '<div><code>'+a.id.slice(0,8)+'</code> '+escapeHtml(a.action)+'</div>' +
      '<div style="color:var(--muted)">'+escapeHtml(a.reason||"")+'</div>' +
      '<div class="actions" style="margin-top:0.5rem">' +
      '<button class="ok" data-approve="'+a.id+'">Approve</button>' +
      '<button class="bad" data-deny="'+a.id+'">Deny</button></div></div>'
    ).join("") || "<p>No pending approvals.</p>"));
    el.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => {
      await api("/api/approvals/"+b.dataset.approve+"/approve", { method:"POST", body:"{}" });
      loadView("approvals");
    });
    el.querySelectorAll("[data-deny]").forEach(b => b.onclick = async () => {
      await api("/api/approvals/"+b.dataset.deny+"/deny", { method:"POST", body:"{}" });
      loadView("approvals");
    });
  } else if (name === "pairings") {
    const data = await api("/api/pairings");
    el.innerHTML = "<h3>Channel pairings</h3>" + ((data.pending||[]).map(p =>
      '<div style="margin:0.75rem 0;padding:0.75rem;border:1px solid var(--line);border-radius:8px">' +
      '<div>'+p.channel+' user <code>'+escapeHtml(p.externalUserId)+'</code></div>' +
      '<div>Code <strong>'+p.code+'</strong></div>' +
      '<div class="actions" style="margin-top:0.5rem">' +
      '<button class="ok" data-papprove="'+p.id+'">Approve</button>' +
      '<button class="bad" data-pdeny="'+p.id+'">Deny</button></div></div>'
    ).join("") || "<p>No pending pairings.</p>"));
    el.querySelectorAll("[data-papprove]").forEach(b => b.onclick = async () => {
      await api("/api/pairings/"+b.dataset.papprove+"/approve", { method:"POST", body:"{}" });
      loadView("pairings");
    });
    el.querySelectorAll("[data-pdeny]").forEach(b => b.onclick = async () => {
      await api("/api/pairings/"+b.dataset.pdeny+"/deny", { method:"POST", body:"{}" });
      loadView("pairings");
    });
  } else if (name === "gateway") {
    const data = await api("/api/gateway/channels");
    el.innerHTML = "<h3>Gateway channels</h3><table><tr><th>Channel</th><th>Status</th><th>Detail</th></tr>" +
      (data.channels||[]).map(c => '<tr><td>'+c.name+'</td><td>'+c.status+'</td><td>'+escapeHtml(c.detail||c.lastError||"")+'</td></tr>').join("") + "</table>";
  } else if (name === "models") {
    const data = await api("/api/models");
    el.innerHTML = "<h3>Models</h3><pre>"+escapeHtml(JSON.stringify(data,null,2))+"</pre>";
  } else if (name === "skills") {
    const data = await api("/api/skills");
    el.innerHTML = "<h3>Skills</h3><ul>"+(data.skills||[]).map(s=>'<li><strong>'+escapeHtml(s.id)+'</strong> — '+escapeHtml(s.description)+'</li>').join("")+"</ul>";
  } else if (name === "memory") {
    const data = await api("/api/memory");
    el.innerHTML = "<h3>Memory</h3><pre>"+escapeHtml(JSON.stringify(data.memories||[],null,2).slice(0,4000))+"</pre>";
  } else if (name === "tasks") {
    el.innerHTML = "<h3>Tasks</h3><p>Open a task from chat events or use CLI <code>forge status</code>. Active session task updates appear in Live run.</p>";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

$("#send").onclick = () => sendMessage().catch(e => addChat("error", String(e), "event"));
$("#input").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    sendMessage().catch(err => addChat("error", String(err), "event"));
  }
});
$("#modes").onclick = (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  state.mode = btn.dataset.mode;
  $("#modes").querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
  if (state.sessionId) {
    api("/api/sessions/"+state.sessionId, { method:"PATCH", body: JSON.stringify({ chatMode: state.mode }) }).catch(()=>{});
  }
};
$("#nav").onclick = (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) showView(btn.dataset.view);
};
$("#themeBtn").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : state.theme === "light" ? "system" : "dark";
  localStorage.setItem("forge-theme", state.theme);
  applyTheme();
};

const commands = [
  { label: "New session", run: async () => { state.sessionId = null; await ensureSession(); await refreshMessages(); showView("chat"); } },
  { label: "Open approvals", run: () => showView("approvals") },
  { label: "Open gateway", run: () => showView("gateway") },
  { label: "Open memory", run: () => showView("memory") },
  { label: "Open models", run: () => showView("models") },
];
function openPalette() {
  $("#palette").classList.add("open");
  const items = $("#paletteItems");
  items.innerHTML = "";
  commands.forEach((c,i) => {
    const b = document.createElement("button");
    b.textContent = c.label;
    b.onclick = async () => { $("#palette").classList.remove("open"); await c.run(); };
    items.appendChild(b);
  });
  $("#paletteInput").value = "";
  $("#paletteInput").focus();
}
$("#paletteBtn").onclick = openPalette;
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  if (e.key === "Escape") $("#palette").classList.remove("open");
});

const es = new EventSource("/api/events/stream");
es.onmessage = (ev) => {
  try {
    const data = JSON.parse(ev.data);
    addLive(data.type, data.payload || {});
    if (data.type === "message.created" && data.payload?.role === "assistant" && data.sessionId === state.sessionId) {
      // already rendered on POST response for web; skip duplicate
    }
  } catch {}
};
es.onerror = () => { $("#onlinePill").textContent = "○ RECONNECTING"; $("#onlinePill").classList.remove("online"); };
es.onopen = () => { $("#onlinePill").textContent = "● ONLINE"; $("#onlinePill").classList.add("online"); };

ensureSession().then(refreshMessages).catch(e => addChat("error", String(e), "event"));
</script>
</body>
</html>`;
