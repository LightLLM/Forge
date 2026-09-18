/** Forge operator web GUI — vanilla SPA served by Gateway (127.0.0.1). */
export const FORGE_GUI_HTML = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Forge</title>
<style>
:root {
  --bg: #f7f8fa;
  --panel: #ffffff;
  --line: #e6e8ee;
  --text: #1c2430;
  --muted: #7a8494;
  --accent: #2f6bff;
  --accent-soft: #eaf0ff;
  --ok: #1a9a5c;
  --bad: #d14343;
  --warn: #c47f12;
  --chip: #f0f2f6;
  --shadow: 0 10px 40px rgba(28, 36, 48, 0.06);
  --radius: 14px;
  --font: "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", sans-serif;
  --brand: Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif;
  --mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
}
html[data-theme="dark"] {
  --bg: #0e1116;
  --panel: #151a22;
  --line: #2a3340;
  --text: #e8edf5;
  --muted: #8b97a8;
  --accent: #5b8cff;
  --accent-soft: #1a2438;
  --chip: #1c2430;
  --shadow: 0 12px 40px rgba(0,0,0,.35);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--font);
  background:
    radial-gradient(900px 420px at 70% -10%, rgba(47,107,255,.08), transparent 55%),
    var(--bg);
  color: var(--text);
  overflow: hidden;
}
button, input, select, textarea { font: inherit; color: inherit; }
#app {
  display: grid;
  grid-template-columns: 248px 1fr;
  height: 100vh;
}
.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  min-height: 0;
}
.side-brand {
  padding: 1.1rem 1rem 0.35rem;
  font-family: var(--brand);
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: 0.04em;
  color: var(--accent);
}
.side-label {
  margin: 0.85rem 1rem 0.35rem;
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
}
.nav-list, .project-list {
  padding: 0 0.55rem;
}
.nav-list button, .project-list button {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  cursor: pointer;
}
.nav-list button:hover, .project-list button:hover,
.nav-list button.active, .project-list button.active {
  background: var(--accent-soft);
  color: var(--text);
}
.nav-list button.active { color: var(--accent); font-weight: 600; }
.side-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  overscroll-behavior: contain;
}
.side-foot {
  border-top: 1px solid var(--line);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex-shrink: 0;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--muted);
}
.pill.online { color: var(--ok); }
.workspace {
  display: grid;
  grid-template-rows: 1fr;
  min-height: 0;
  position: relative;
  isolation: isolate;
}
#center {
  display: grid;
  grid-template-rows: 1fr;
  min-height: 0;
  position: relative;
}
#chat-shell {
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 0;
  height: 100%;
  position: relative;
}
#emptyHero {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  display: grid;
  place-content: center;
  text-align: center;
  padding: 2rem 2rem 8rem;
  pointer-events: none;
  z-index: 1;
  animation: rise 0.55s ease both;
}
#emptyHero.hidden { display: none; }
@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.hero-brand {
  margin: 0;
  font-family: var(--brand);
  font-weight: 700;
  font-size: clamp(3.8rem, 9vw, 6.4rem);
  line-height: 0.95;
  letter-spacing: 0.01em;
  color: var(--accent);
  text-transform: uppercase;
}
.hero-sub {
  margin: 1rem auto 0;
  max-width: 34rem;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.45;
}
#chat {
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1.5rem 1.5rem 1.25rem;
  min-height: 0;
  height: 100%;
  position: relative;
  z-index: 2;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.msg { margin: 0 auto 1rem; max-width: 46rem; }
.msg .who {
  font-size: 0.72rem;
  color: var(--muted);
  margin-bottom: 0.25rem;
  font-family: var(--mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.msg .body { white-space: pre-wrap; line-height: 1.5; font-size: 0.98rem; }
.msg.event .body { color: var(--muted); font-family: var(--mono); font-size: 0.84rem; }
.msg.you .body {
  background: var(--accent-soft);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.75rem 0.9rem;
}
#composer-wrap {
  position: relative;
  left: auto; right: auto; bottom: auto;
  padding: 0 1.25rem 1rem;
  background: linear-gradient(to top, var(--bg) 70%, transparent);
  z-index: 10;
  pointer-events: auto;
}
#composer {
  max-width: 52rem;
  margin: 0 auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 0.65rem 0.75rem 0.55rem;
}
.modes {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.45rem;
  padding: 0 0.2rem;
}
.modes button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.modes button.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 25%, transparent);
}
#attach {
  width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--chip);
  cursor: pointer; color: var(--text); font-size: 1.1rem;
}
#attach:hover { border-color: var(--accent); color: var(--accent); }
#attach-menu {
  display: none; position: absolute; left: 0.75rem; bottom: 100%;
  margin-bottom: 0.35rem; background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; z-index: 30;
  min-width: 11rem;
}
#attach-menu.open { display: block; }
#attach-menu button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 0.65rem 0.9rem; cursor: pointer; color: var(--text); font-size: 0.88rem;
}
#attach-menu button:hover { background: var(--accent-soft); color: var(--accent); }
#attach-chips {
  display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0 0.2rem 0.45rem;
}
#attach-chips:empty { display: none; }
.attach-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  border: 1px solid var(--line); background: var(--chip); border-radius: 999px;
  padding: 0.2rem 0.55rem; font-size: 0.75rem; max-width: 100%;
}
.attach-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14rem; }
.attach-chip button {
  border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; font-size: 0.9rem;
}
#composer.drag-over {
  outline: 2px dashed var(--accent); outline-offset: 2px;
}
.row { display: flex; align-items: flex-end; gap: 0.45rem; position: relative; }
textarea {
  flex: 1;
  min-height: 40px;
  max-height: 140px;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  padding: 0.55rem 0.35rem;
  line-height: 1.4;
}
#send {
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: 12px;
  padding: 0.55rem 0.95rem;
  font-weight: 600;
  cursor: pointer;
}
#send:hover { filter: brightness(1.05); }
.status-bar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.35rem 0.35rem 0;
  font-size: 0.72rem;
  color: var(--muted);
}
#center-views {
  display: none;
  overflow: auto;
  padding: 1.25rem 1.5rem 2rem;
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 5;
}
#center-views.active { display: block; }
#center.hidden-chat { visibility: hidden; pointer-events: none; }
.view { display: none; }
.view.active { display: block; }
.view h3 { margin-top: 0; font-family: var(--brand); }
.view .muted { color: var(--muted); font-size: 0.88rem; }
.stat-row {
  display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.75rem 0 1.25rem;
}
.stat {
  min-width: 7.5rem; padding: 0.65rem 0.85rem;
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
}
.stat .n { font-size: 1.15rem; font-weight: 700; font-family: var(--mono); }
.stat .l { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
#term {
  background: #0b0f14; color: #d7e0ea; border-radius: 12px;
  border: 1px solid var(--line); font-family: var(--mono); font-size: 0.8rem;
  height: min(58vh, 520px); overflow: auto; padding: 0.85rem 1rem; white-space: pre-wrap;
}
#term .cmd { color: #7dd3a7; }
#term .err { color: #f0a0a0; }
#term .meta { color: #7a8494; }
#term-form {
  display: flex; gap: 0.5rem; margin-top: 0.75rem; align-items: center;
}
#term-input {
  flex: 1; border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel); padding: 0.65rem 0.8rem; font-family: var(--mono); font-size: 0.85rem;
}
#term-run {
  border: 0; border-radius: 10px; background: var(--accent); color: #fff;
  padding: 0.65rem 1rem; cursor: pointer; font-weight: 600;
}
#session-recents button { font-size: 0.82rem; }
table tr.clickable { cursor: pointer; }
table tr.clickable:hover { background: var(--accent-soft); }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
td, th { text-align: left; padding: 0.5rem 0.35rem; border-bottom: 1px solid var(--line); }
.actions button {
  margin-right: 0.35rem; padding: 0.3rem 0.6rem;
  border: 1px solid var(--line); background: var(--chip);
  border-radius: 8px; cursor: pointer;
}
.actions .ok { border-color: var(--ok); color: var(--ok); }
.actions .bad { border-color: var(--bad); color: var(--bad); }
#live {
  max-height: min(36vh, 240px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--muted);
  border-top: 1px dashed var(--line);
  margin-top: 0.45rem;
  padding-top: 0.35rem;
  -webkit-overflow-scrolling: touch;
}
.live-item { padding: 0.15rem 0; }
.live-item strong { color: var(--text); font-weight: 600; }
#palette {
  display: none; position: fixed; inset: 0; background: rgba(20,24,32,.35);
  align-items: flex-start; justify-content: center; padding-top: 14vh; z-index: 50;
  backdrop-filter: blur(4px);
}
#palette.open { display: flex; }
#palette .box {
  width: min(520px, 92vw); background: var(--panel); border: 1px solid var(--line);
  border-radius: 16px; overflow: hidden; box-shadow: var(--shadow);
}
#palette input {
  width: 100%; border: 0; border-bottom: 1px solid var(--line); background: transparent;
  padding: 0.95rem 1rem; outline: none;
}
#palette .items button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 0.75rem 1rem; cursor: pointer;
}
#palette .items button:hover { background: var(--accent-soft); }
#mobile-tabs { display: none; }
@media (max-width: 900px) {
  #app { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .sidebar.mobile-open {
    display: grid; position: fixed; inset: 0 30% 56px 0; z-index: 20;
    box-shadow: var(--shadow);
  }
  #mobile-tabs {
    display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 56px;
    border-top: 1px solid var(--line); background: var(--panel); z-index: 25;
  }
  #mobile-tabs button { flex: 1; border: 0; background: transparent; color: var(--muted); }
  #mobile-tabs button.active { color: var(--accent); font-weight: 600; }
  #composer-wrap { padding-bottom: 4.25rem; }
}
</style>
</head>
<body>
<div id="app">
  <aside class="sidebar" id="sidebar">
    <div class="side-brand">FORGE</div>
    <div>
      <div class="side-label">Sessions</div>
      <div class="nav-list">
        <button type="button" id="newSessionBtn">＋ New session</button>
        <button type="button" id="paletteBtn">⌘K Commands</button>
      </div>
      <div id="session-recents" class="nav-list"></div>
      <div class="side-label">Workspace</div>
      <div class="nav-list" id="nav">
        <button data-view="chat" class="active">Chat</button>
        <button data-view="sessions">Sessions</button>
        <button data-view="terminal">Terminal</button>
        <button data-view="traces">Eval &amp; Traces</button>
        <button data-view="tasks">Jobs</button>
        <button data-view="agents">Agents</button>
        <button data-view="approvals">Approvals</button>
        <button data-view="pairings">Pairings</button>
        <button data-view="memory">Memory</button>
        <button data-view="skills">Skills</button>
        <button data-view="tools">Tools</button>
        <button data-view="models">Models</button>
        <button data-view="gateway">Gateway</button>
        <button data-view="settings">Settings</button>
      </div>
    </div>
    <div class="side-scroll">
      <div class="side-label">Project</div>
      <div class="project-list">
        <button type="button" class="active" id="projectPill">project</button>
      </div>
      <div class="side-label">Live activity</div>
      <div id="live" style="padding:0 0.9rem 1rem"></div>
    </div>
    <div class="side-foot">
      <span class="pill" id="modePill">local-preferred</span>
      <span class="pill online" id="onlinePill">● Online</span>
      <button type="button" class="pill" id="themeBtn" style="border:0;background:transparent;cursor:pointer;padding:0;text-align:left">Toggle theme</button>
    </div>
  </aside>

  <section class="workspace">
    <section id="center">
      <div id="chat-shell">
        <div id="emptyHero">
          <h1 class="hero-brand">Forge</h1>
          <p class="hero-sub">Drop a file path, a traceback, or a rough idea. I’ll investigate, suggest next steps, and keep things reversible.</p>
        </div>
        <div id="chat"></div>
        <div id="composer-wrap">
          <div id="composer">
            <div class="modes" id="modes">
              <button data-mode="ask" class="active">ASK</button>
              <button data-mode="plan">PLAN</button>
              <button data-mode="build">BUILD</button>
              <button data-mode="debug">DEBUG</button>
              <button data-mode="review">REVIEW</button>
            </div>
            <div id="attach-chips"></div>
            <div class="row">
              <div id="attach-menu">
                <button type="button" data-attach="files">Add files</button>
                <button type="button" data-attach="images">Add pictures</button>
                <button type="button" data-attach="folder">Add folder path</button>
              </div>
              <button type="button" id="attach" title="Add files, pictures, or a folder">＋</button>
              <input type="file" id="filePick" multiple hidden />
              <input type="file" id="imagePick" accept="image/*" multiple hidden />
              <textarea id="input" placeholder="Ask anything — or drop files here" rows="1"></textarea>
              <button type="button" id="send">Send</button>
            </div>
            <div class="status-bar">
              <span>Mode enforced by policy</span>
              <span id="modelHint">Local / OpenRouter</span>
            </div>
          </div>
        </div>
      </div>
    </section>
    <div id="center-views">
      <div class="view" id="view-sessions"></div>
      <div class="view" id="view-terminal">
        <h3>Terminal</h3>
        <p class="muted">Allowlisted workspace commands only (same policy as agent tools). Output stays local.</p>
        <div id="term"></div>
        <form id="term-form" autocomplete="off">
          <span class="meta" style="font-family:var(--mono);color:var(--muted)">$</span>
          <input id="term-input" placeholder="git status" spellcheck="false" />
          <button type="submit" id="term-run">Run</button>
        </form>
        <p class="muted" id="term-hint" style="margin-top:0.65rem"></p>
      </div>
      <div class="view" id="view-traces"></div>
      <div class="view" id="view-tasks"></div>
      <div class="view" id="view-agents"></div>
      <div class="view" id="view-approvals"></div>
      <div class="view" id="view-pairings"></div>
      <div class="view" id="view-memory"></div>
      <div class="view" id="view-skills"></div>
      <div class="view" id="view-tools"></div>
      <div class="view" id="view-models"></div>
      <div class="view" id="view-gateway"></div>
      <div class="view" id="view-settings"><p>Bound to <code>127.0.0.1</code> by default. Secrets never leave the server env. Chats, traces, and logs persist in the local Forge SQLite database.</p></div>
    </div>
  </section>
</div>
<div id="mobile-tabs">
  <button data-mobile="nav">Menu</button>
  <button data-mobile="chat" class="active">Chat</button>
  <button data-mobile="approvals">Approvals</button>
</div>
<div id="palette"><div class="box"><input id="paletteInput" placeholder="Type a command…"/><div class="items" id="paletteItems"></div></div></div>
<script>
const state = {
  sessionId: null,
  mode: "ask",
  theme: localStorage.getItem("forge-theme") || "light",
  workspacePath: null,
  pending: [],
  lastForgeText: "",
  termReady: false,
};
const $ = (s) => document.querySelector(s);
const chat = $("#chat");
const live = $("#live");

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
}
applyTheme();

function setEmptyVisible(show) {
  $("#emptyHero").classList.toggle("hidden", !show);
}

async function api(path, opts) {
  const ctrl = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 25_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { timeoutMs: _t, ...fetchOpts } = opts || {};
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(fetchOpts?.headers||{}) },
      ...fetchOpts,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : res.statusText);
    return data;
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("Request timed out — is the Forge runtime running?");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function addChat(who, body, cls="") {
  if (who === "forge") {
    const key = String(body);
    if (key && key === state.lastForgeText) return;
    state.lastForgeText = key;
  }
  setEmptyVisible(false);
  const el = document.createElement("div");
  el.className = "msg " + (who === "you" ? "you " : "") + cls;
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

async function ensureSession(opts) {
  if (state.sessionId) return state.sessionId;
  const forceNew = opts && opts.forceNew;
  const status = await api("/api/system/status");
  state.workspacePath = status.workspacePath || null;
  $("#projectPill").textContent = (status.workspacePath || "").split(/[/\\\\]/).pop() || "project";
  $("#modePill").textContent = status.mode || "local-preferred";
  try {
    const models = await api("/api/models");
    const local = models.local?.model || "local unset";
    const cloud = models.cloud?.model || "cloud unset";
    $("#modelHint").textContent = local + " / " + cloud;
  } catch {}

  if (!forceNew) {
    const saved = localStorage.getItem("forge-session-id");
    if (saved) {
      try {
        const got = await api("/api/sessions/" + saved);
        if (got.session && !got.session.closedAt) {
          state.sessionId = got.session.id;
          if (got.session.chatMode) state.mode = got.session.chatMode;
          syncModeButtons();
          await refreshSessionRecents();
          return state.sessionId;
        }
      } catch {}
    }

    try {
      const list = await api("/api/sessions");
      const match = (list.sessions || []).find((s) =>
        s.channel === "web" &&
        (!status.workspacePath || s.workspacePath === status.workspacePath)
      );
      if (match) {
        state.sessionId = match.id;
        if (match.chatMode) state.mode = match.chatMode;
        localStorage.setItem("forge-session-id", match.id);
        syncModeButtons();
        await refreshSessionRecents();
        return state.sessionId;
      }
    } catch {}
  }

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
  localStorage.setItem("forge-session-id", state.sessionId);
  await refreshSessionRecents();
  return state.sessionId;
}

function syncModeButtons() {
  document.querySelectorAll("#modes button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === state.mode);
  });
}

async function openSession(id) {
  state.sessionId = id;
  state.lastForgeText = "";
  localStorage.setItem("forge-session-id", id);
  try {
    const got = await api("/api/sessions/" + id);
    if (got.session?.chatMode) {
      state.mode = got.session.chatMode;
      syncModeButtons();
    }
  } catch {}
  await refreshMessages();
  await refreshSessionRecents();
  showView("chat");
}

async function refreshSessionRecents() {
  const el = $("#session-recents");
  if (!el) return;
  try {
    const data = await api("/api/sessions");
    const sessions = (data.sessions || []).slice(0, 6);
    el.innerHTML = sessions.map((s) => {
      const label = (s.title || s.id.slice(0, 8)).slice(0, 28);
      const active = s.id === state.sessionId ? " active" : "";
      return '<button type="button" class="'+active+'" data-open-session="'+s.id+'" title="'+escapeHtml(s.title)+'">'+escapeHtml(label)+'</button>';
    }).join("");
    el.querySelectorAll("[data-open-session]").forEach((b) => {
      b.onclick = () => openSession(b.dataset.openSession);
    });
  } catch {
    el.innerHTML = "";
  }
}

function termWrite(html) {
  const term = $("#term");
  if (!term) return;
  const line = document.createElement("div");
  line.innerHTML = html;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

async function ensureTerminal() {
  if (!state.termReady) {
    termWrite('<span class="meta">Forge terminal — allowlisted commands in the project workspace.</span>');
    $("#term-form").onsubmit = async (e) => {
      e.preventDefault();
      const input = $("#term-input");
      const cmd = (input.value || "").trim();
      if (!cmd) return;
      input.value = "";
      termWrite('<span class="cmd">$ ' + escapeHtml(cmd) + "</span>");
      try {
        const result = await api("/api/terminal/exec", {
          method: "POST",
          body: JSON.stringify({ command: cmd }),
          timeoutMs: 180_000,
        });
        if (result.stdout) termWrite(escapeHtml(result.stdout));
        if (result.stderr) termWrite('<span class="err">' + escapeHtml(result.stderr) + "</span>");
        termWrite('<span class="meta">exit ' + String(result.exitCode) + (result.timedOut ? " (timed out)" : "") + " · " + (result.latencyMs || 0) + "ms</span>");
      } catch (err) {
        termWrite('<span class="err">' + escapeHtml(String(err)) + "</span>");
      }
    };
    state.termReady = true;
  }
  try {
    const data = await api("/api/terminal/allowlist");
    $("#term-hint").textContent = "Allowed: " + (data.allowlist || []).slice(0, 12).join(", ") + ((data.allowlist||[]).length > 12 ? "…" : "");
  } catch (err) {
    $("#term-hint").textContent = String(err);
  }
}

async function refreshMessages() {
  if (!state.sessionId) return;
  const data = await api("/api/sessions/" + state.sessionId + "/messages");
  chat.innerHTML = "";
  state.lastForgeText = "";
  const msgs = data.messages || [];
  setEmptyVisible(msgs.length === 0);
  for (const m of msgs) {
    addChat(m.role === "assistant" ? "forge" : m.role, m.content?.text || "", m.role === "event" ? "event" : "");
  }
  if (msgs.length === 0) setEmptyVisible(true);
}

function renderAttachChips() {
  const el = $("#attach-chips");
  el.innerHTML = "";
  state.pending.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.innerHTML = "<span></span><button type='button' title='Remove'>×</button>";
    chip.querySelector("span").textContent = a.name + (a.workspacePath ? " (path)" : "");
    chip.querySelector("button").onclick = () => {
      state.pending.splice(i, 1);
      renderAttachChips();
    };
    el.appendChild(chip);
  });
}

function closeAttachMenu() {
  $("#attach-menu").classList.remove("open");
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    if (isProbablyDirectory(file)) {
      reject(new Error("DIR:" + (file.path || file.name)));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error(file.name + " is larger than 2 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        dataBase64,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read " + file.name));
    reader.readAsDataURL(file);
  });
}

function isProbablyDirectory(file) {
  if (!file) return false;
  // Electron folder drops / empty directory File objects
  if (file.size === 0 && !file.type) return true;
  return false;
}

function pushFolderAttachment(absOrRel) {
  if (state.pending.length >= 8) throw new Error("Max 8 attachments");
  let rel = toWorkspaceRelative(absOrRel);
  if (!rel) {
    // Already relative?
    const cleaned = String(absOrRel).replace(/\\\\/g, "/").replace(/^\\/+/, "");
    if (!cleaned.includes("..") && !/^[a-zA-Z]:/.test(cleaned) && !cleaned.startsWith("/")) {
      rel = cleaned;
    }
  }
  if (!rel) {
    throw new Error("Folder must be inside the open project: " + (state.workspacePath || "(unknown)"));
  }
  const normalized = rel.endsWith("/") ? rel : rel + "/";
  state.pending.push({
    name: normalized.split("/").filter(Boolean).pop() || normalized,
    mimeType: "inode/directory",
    sizeBytes: 0,
    workspacePath: normalized,
  });
}

async function addFiles(fileList) {
  const files = [...(fileList || [])];
  for (const f of files) {
    try {
      if (isProbablyDirectory(f) || (f.path && f.size === 0)) {
        const abs = f.path || f.name;
        pushFolderAttachment(abs);
        continue;
      }
      const att = await fileToAttachment(f);
      if (state.pending.length >= 8) throw new Error("Max 8 attachments");
      state.pending.push(att);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (msg.startsWith("DIR:")) {
        try {
          pushFolderAttachment(msg.slice(4));
        } catch (e2) {
          addChat("error", String(e2), "event");
        }
      } else {
        addChat("error", msg, "event");
      }
    }
  }
  renderAttachChips();
}

async function addDataTransfer(dt) {
  if (!dt) return;
  const items = dt.items ? [...dt.items] : [];
  if (items.length) {
    for (const item of items) {
      try {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (entry && entry.isDirectory) {
          const file = item.getAsFile && item.getAsFile();
          const abs = (file && file.path) || entry.fullPath || entry.name;
          pushFolderAttachment(String(abs).replace(/^\\/+/, ""));
          continue;
        }
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) await addFiles([f]);
        }
      } catch (err) {
        addChat("error", String(err), "event");
      }
    }
    renderAttachChips();
    return;
  }
  await addFiles(dt.files);
}

function toWorkspaceRelative(absPath) {
  const root = (state.workspacePath || "").replace(/[\\\\/]+$/, "");
  if (!root) return null;
  const normRoot = root.replace(/\\\\/g, "/").toLowerCase();
  const normPath = String(absPath).replace(/\\\\/g, "/");
  const lower = normPath.toLowerCase();
  if (lower === normRoot) return ".";
  if (lower.startsWith(normRoot + "/")) {
    return normPath.slice(root.length).replace(/^[\\\\/]+/, "").replace(/\\\\/g, "/");
  }
  return null;
}

async function addFolderPath() {
  await ensureSession();
  const desktop = window.forgeDesktop;
  if (desktop?.pickFolder) {
    const folder = await desktop.pickFolder();
    if (!folder) return;
    const rel = toWorkspaceRelative(folder);
    if (!rel) {
      addChat("error", "Folder must be inside the open project workspace: " + (state.workspacePath || ""), "event");
      return;
    }
    if (state.pending.length >= 8) {
      addChat("error", "Max 8 attachments", "event");
      return;
    }
    state.pending.push({
      name: rel.split("/").filter(Boolean).pop() || rel,
      mimeType: "inode/directory",
      sizeBytes: 0,
      workspacePath: rel.endsWith("/") ? rel : rel + "/",
    });
    renderAttachChips();
    return;
  }
  const hint = prompt("Paste a folder path inside this project:", state.workspacePath ? state.workspacePath + "\\\\" : "");
  if (!hint) return;
  const rel = toWorkspaceRelative(hint) || (hint.includes("..") ? null : hint.replace(/\\\\/g, "/").replace(/^\\/+/, ""));
  if (!rel) {
    addChat("error", "Folder path must stay inside the project workspace.", "event");
    return;
  }
  state.pending.push({
    name: rel.split("/").filter(Boolean).pop() || rel,
    mimeType: "inode/directory",
    sizeBytes: 0,
    workspacePath: rel.endsWith("/") ? rel : rel + "/",
  });
  renderAttachChips();
}

async function sendMessage() {
  const text = $("#input").value.trim();
  const attachments = state.pending.slice();
  if (!text && attachments.length === 0) return;
  const pending = text;
  $("#input").value = "";
  state.pending = [];
  renderAttachChips();
  setEmptyVisible(false);
  const preview = pending || attachments.map(a => a.name).join(", ");
  addChat("you", preview + (attachments.length && pending ? "\\n(" + attachments.length + " attachment(s))" : ""));
  try {
    await ensureSession();
    const result = await api("/api/sessions/" + state.sessionId + "/messages", {
      method: "POST",
      body: JSON.stringify({
        content: pending,
        mode: state.mode,
        attachments: attachments.map(a => ({
          name: a.name,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          dataBase64: a.dataBase64,
          workspacePath: a.workspacePath,
        })),
      }),
      timeoutMs: 300_000,
    });
    if (result.message?.content?.text) addChat("forge", result.message.content.text);
  } catch (err) {
    addChat("error", String(err), "event");
  }
}

function showView(name) {
  document.querySelectorAll("#nav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  if (name === "chat") {
    $("#center").classList.remove("hidden-chat");
    $("#center-views").classList.remove("active");
    document.querySelectorAll("#center-views .view").forEach((v) => v.classList.remove("active"));
    return;
  }
  $("#center").classList.add("hidden-chat");
  $("#center-views").classList.add("active");
  document.querySelectorAll("#center-views .view").forEach((v) => {
    v.classList.toggle("active", v.id === "view-" + name);
  });
  loadView(name).catch((err) => {
    const el = $("#view-" + name);
    if (el) el.innerHTML = "<p class='err'>" + escapeHtml(String(err)) + "</p>";
  });
}

async function loadView(name) {
  const el = $("#view-" + name);
  if (!el) return;
  if (name === "sessions") {
    const data = await api("/api/sessions");
    el.innerHTML = "<h3>Sessions</h3><p class='muted'>Stored locally in SQLite. Click a row to reopen the chat.</p><table><tr><th>Updated</th><th>Channel</th><th>Mode</th><th>Title</th></tr>" +
      (data.sessions||[]).map(s =>
        '<tr class="clickable" data-open-session="'+s.id+'"><td>'+escapeHtml((s.updatedAt||"").slice(0,19).replace("T"," "))+'</td><td>'+s.channel+'</td><td>'+s.chatMode+'</td><td>'+escapeHtml(s.title)+'</td></tr>'
      ).join("") + "</table>";
    el.querySelectorAll("[data-open-session]").forEach((row) => {
      row.onclick = () => openSession(row.dataset.openSession);
    });
  } else if (name === "terminal") {
    await ensureTerminal();
  } else if (name === "traces") {
    const [traceData, logData] = await Promise.all([
      api("/api/traces?limit=80"),
      api("/api/logs?limit=80"),
    ]);
    const s = traceData.summary || {};
    el.innerHTML =
      "<h3>Eval &amp; Traces</h3>" +
      "<p class='muted'>Local model token usage, latency, and error log. Persisted across restarts.</p>" +
      "<div class='stat-row'>" +
      "<div class='stat'><div class='n'>"+(s.calls||0)+"</div><div class='l'>Calls</div></div>" +
      "<div class='stat'><div class='n'>"+(s.promptTokens||0)+"</div><div class='l'>Prompt toks</div></div>" +
      "<div class='stat'><div class='n'>"+(s.completionTokens||0)+"</div><div class='l'>Completion</div></div>" +
      "<div class='stat'><div class='n'>"+Number(s.estimatedCostUsd||0).toFixed(4)+"</div><div class='l'>Est. USD</div></div>" +
      "<div class='stat'><div class='n'>"+(s.errors||0)+"</div><div class='l'>Errors</div></div>" +
      "</div>" +
      "<h3 style='font-size:1.05rem;margin-top:1.5rem'>Model calls</h3>" +
      "<table><tr><th>When</th><th>Provider</th><th>Model</th><th>In</th><th>Out</th><th>ms</th><th>Status</th></tr>" +
      (traceData.traces||[]).map(t =>
        "<tr><td>"+escapeHtml((t.createdAt||"").slice(11,19))+"</td><td>"+escapeHtml(t.provider)+"</td><td>"+escapeHtml(t.model)+"</td><td>"+(t.promptTokens??"—")+"</td><td>"+(t.completionTokens??"—")+"</td><td>"+(t.latencyMs??"—")+"</td><td>"+(t.status==="error"?"<span style='color:var(--bad)'>error</span>":"ok")+(t.error?" — "+escapeHtml(String(t.error).slice(0,80)):"")+"</td></tr>"
      ).join("") + "</table>" +
      "<h3 style='font-size:1.05rem;margin-top:1.5rem'>Error / warn log</h3>" +
      "<table><tr><th>When</th><th>Level</th><th>Scope</th><th>Message</th></tr>" +
      (logData.logs||[]).map(l =>
        "<tr><td>"+escapeHtml((l.createdAt||"").slice(11,19))+"</td><td>"+l.level+"</td><td>"+escapeHtml(l.scope)+"</td><td>"+escapeHtml(l.message)+"</td></tr>"
      ).join("") + "</table>";
  } else if (name === "approvals") {
    const data = await api("/api/approvals");
    el.innerHTML = "<h3>Approvals</h3>" + ((data.pending||[]).map(a =>
      '<div style="margin:0.75rem 0;padding:0.75rem;border:1px solid var(--line);border-radius:8px">' +
      '<div><code>'+a.id.slice(0,8)+'</code> '+escapeHtml(a.action)+'</div>' +
      '<div style="color:var(--muted)">'+escapeHtml(a.reason||"")+'</div>' +
      '<div class="actions" style="margin-top:0.5rem">' +
      '<button class="ok" data-approve="'+a.id+'">Approve</button>' +
      '<button class="bad" data-deny="'+a.id+'">Deny</button></div></div>'
    ).join("") || "<p>No pending approvals.</p>");
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
    ).join("") || "<p>No pending pairings.</p>");
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
    el.innerHTML = "<h3>Gateway channels</h3><p class='muted'>Telegram / Slack need env tokens. WhatsApp is stubbed until Cloud API. Use Probe to verify credentials without sending chat messages.</p><table><tr><th>Channel</th><th>Status</th><th>Detail</th></tr>" +
      (data.channels||[]).map(c => '<tr><td>'+c.name+'</td><td>'+c.status+'</td><td>'+escapeHtml(c.detail||c.lastError||"")+'</td></tr>').join("") + "</table>" +
      "<div class='actions' style='margin-top:0.75rem'><button type='button' class='ok' id='probeChannels'>Probe connections</button></div>" +
      "<pre id='probeOut' style='margin-top:0.75rem;font-size:0.8rem;white-space:pre-wrap'></pre>";
    const btn = el.querySelector("#probeChannels");
    if (btn) btn.onclick = async () => {
      const out = el.querySelector("#probeOut");
      if (out) out.textContent = "Probing…";
      try {
        const probe = await api("/api/gateway/channels/probe", { method:"POST", body:"{}", timeoutMs: 30_000 });
        if (out) out.textContent = JSON.stringify(probe.probes||[], null, 2);
      } catch (err) {
        if (out) out.textContent = String(err);
      }
    };
  } else if (name === "models") {
    const data = await api("/api/models");
    el.innerHTML = "<h3>Models</h3><pre>"+escapeHtml(JSON.stringify(data,null,2))+"</pre>";
  } else if (name === "skills") {
    const data = await api("/api/skills");
    el.innerHTML = "<h3>Skills</h3><ul>"+(data.skills||[]).map(s=>'<li><strong>'+escapeHtml(s.id)+'</strong> — '+escapeHtml(s.description)+'</li>').join("")+"</ul>";
  } else if (name === "tools") {
    const data = await api("/api/tools");
    const packs = (data.packs||[]).join(", ");
    const net = data.allowNetwork ? "enabled" : "disabled (set tools.allowNetwork or FORGE_ALLOW_NETWORK=1)";
    el.innerHTML =
      "<h3>Tools</h3>" +
      "<p class='muted'>Hermes-style agent tools for BUILD runs. Packs: <code>"+escapeHtml(packs)+"</code>. Network: <strong>"+escapeHtml(net)+"</strong>.</p>" +
      "<table><tr><th>Name</th><th>Risk</th><th>Description</th></tr>" +
      (data.tools||[]).map(t =>
        "<tr><td><code>"+escapeHtml(t.name)+"</code></td><td>"+escapeHtml(t.risk)+(t.networkGated?" *":"")+"</td><td>"+escapeHtml(t.description)+"</td></tr>"
      ).join("") +
      "</table>" +
      "<p class='muted' style='margin-top:1rem'>* Network tools stay off until explicitly enabled — Forge stays local-first.</p>";
  } else if (name === "memory") {
    const data = await api("/api/memory");
    el.innerHTML = "<h3>Memory</h3><pre>"+escapeHtml(JSON.stringify(data.memories||[],null,2).slice(0,4000))+"</pre>";
  } else if (name === "tasks") {
    const [catalog, schedules, daemon] = await Promise.all([
      api("/api/jobs/catalog"),
      api("/api/jobs/schedules"),
      api("/api/jobs/daemon").catch(() => ({ daemon: null })),
    ]);
    const d = daemon.daemon;
    el.innerHTML =
      "<h3>Jobs &amp; schedules</h3>" +
      "<p class='muted'>Repetitive engineering analyses via the Forge daemon. Interval or 5-field UTC cron. Analyses propose only — never silent rewrites.</p>" +
      "<p class='muted'>Daemon: " + (d && d.running ? ("running · workers " + (d.activeWorkers ?? "?") + "/" + (d.maxWorkers ?? "?")) : "stopped — run <code>forge daemon start</code>") + "</p>" +
      "<h3 style='font-size:1.05rem'>Catalog</h3><table><tr><th>Id</th><th>Name</th><th>Default</th></tr>" +
      (catalog.catalog||[]).map(c => "<tr><td><code>"+escapeHtml(c.id)+"</code></td><td>"+escapeHtml(c.name)+"</td><td>"+Math.round((c.defaultEveryMs||0)/3600000)+"h</td></tr>").join("") +
      "</table>" +
      "<div class='actions' style='margin:0.75rem 0'><label>Analysis <select id='jobAnalysis'></select></label> " +
      "<label>Cron <input id='jobCron' placeholder='0 */6 * * *' style='width:9rem'/></label> " +
      "<button type='button' class='ok' id='jobSchedule'>Schedule</button> " +
      "<button type='button' id='jobRunNow'>Run now</button></div>" +
      "<h3 style='font-size:1.05rem'>Schedules</h3><table><tr><th>Status</th><th>Analysis</th><th>When</th><th>Runs</th><th>Next</th><th></th></tr>" +
      ((schedules.schedules||[]).map(s =>
        "<tr><td>"+s.status+"</td><td>"+escapeHtml(s.analysisId)+"</td><td>"+(s.cronExpr?("<code>"+escapeHtml(s.cronExpr)+"</code>"):(s.everyMs+"ms"))+"</td><td>"+s.runCount+"</td><td>"+escapeHtml((s.nextRunAt||"").slice(0,19))+"</td><td>" +
        (s.status==="active"
          ? "<button type='button' data-pause='"+s.id+"'>Pause</button>"
          : "<button type='button' data-resume='"+s.id+"'>Resume</button>") +
        "</td></tr>"
      ).join("") || "<tr><td colspan='6'>No schedules yet.</td></tr>") +
      "</table>";
    const sel = el.querySelector("#jobAnalysis");
    (catalog.catalog||[]).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.id;
      sel.appendChild(o);
    });
    el.querySelector("#jobSchedule").onclick = async () => {
      const analysisId = sel.value;
      const cron = (el.querySelector("#jobCron").value || "").trim();
      await api("/api/jobs/schedules", {
        method: "POST",
        body: JSON.stringify({ analysisId, cron: cron || undefined }),
      });
      loadView("tasks");
    };
    el.querySelector("#jobRunNow").onclick = async () => {
      const analysisId = sel.value;
      const res = await api("/api/jobs/run", {
        method: "POST",
        body: JSON.stringify({ analysisId }),
        timeoutMs: 120_000,
      });
      alert((res.report && res.report.summary) || "done");
    };
    el.querySelectorAll("[data-pause]").forEach(b => b.onclick = async () => {
      await api("/api/jobs/schedules/"+b.dataset.pause+"/pause", { method:"POST", body:"{}" });
      loadView("tasks");
    });
    el.querySelectorAll("[data-resume]").forEach(b => b.onclick = async () => {
      await api("/api/jobs/schedules/"+b.dataset.resume+"/resume", { method:"POST", body:"{}" });
      loadView("tasks");
    });
  } else if (name === "agents") {
    const [roles, pipes] = await Promise.all([
      api("/api/agents/roles"),
      api("/api/agents/pipelines"),
    ]);
    el.innerHTML =
      "<h3>Multi-agent setup</h3>" +
      "<p class='muted'>Forge uses specialized roles (not nested Hermes-style subagents). BUILD picks a role by phase; Goal mode runs a task DAG with parallel workers. Agents enabled: <code>"+String(roles.agentsEnabled)+"</code>.</p>" +
      "<h3 style='font-size:1.05rem'>Pipelines</h3><ul>" +
      (pipes.pipelines||[]).map(p => "<li><strong>"+escapeHtml(p.id)+"</strong> — "+escapeHtml(p.stages.join(" → "))+"<br/><span class='muted'>"+escapeHtml(p.description)+"</span></li>").join("") +
      "</ul>" +
      (pipes.note ? "<p class='muted'>"+escapeHtml(pipes.note)+"</p>" : "") +
      "<h3 style='font-size:1.05rem'>Roles</h3><table><tr><th>Id</th><th>Writes</th><th>Exec</th><th>Tools</th><th>Description</th></tr>" +
      (roles.roles||[]).map(r =>
        "<tr><td><code>"+escapeHtml(r.id)+"</code></td><td>"+r.permissions.allowWrites+"</td><td>"+r.permissions.allowExecute+"</td><td style='font-size:0.75rem'>"+escapeHtml((r.allowedTools||[]).slice(0,6).join(", "))+"…</td><td>"+escapeHtml(r.description)+"</td></tr>"
      ).join("") +
      "</table>";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

$("#send").onclick = () => sendMessage();
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
$("#attach").onclick = (e) => {
  e.stopPropagation();
  $("#attach-menu").classList.toggle("open");
};
$("#attach-menu").onclick = async (e) => {
  const btn = e.target.closest("button[data-attach]");
  if (!btn) return;
  closeAttachMenu();
  const kind = btn.dataset.attach;
  if (kind === "files") $("#filePick").click();
  else if (kind === "images") $("#imagePick").click();
  else if (kind === "folder") await addFolderPath().catch((err) => addChat("error", String(err), "event"));
};
$("#filePick").onchange = () => { addFiles($("#filePick").files).finally(() => { $("#filePick").value = ""; }); };
$("#imagePick").onchange = () => { addFiles($("#imagePick").files).finally(() => { $("#imagePick").value = ""; }); };
document.addEventListener("click", (e) => {
  if (!e.target.closest("#attach-menu") && !e.target.closest("#attach")) closeAttachMenu();
  const modeBtn = e.target.closest && e.target.closest("#modes button[data-mode]");
  if (modeBtn) {
    state.mode = modeBtn.dataset.mode;
    $("#modes").querySelectorAll("button").forEach(b => b.classList.toggle("active", b === modeBtn));
    if (state.sessionId) {
      api("/api/sessions/"+state.sessionId, { method:"PATCH", body: JSON.stringify({ chatMode: state.mode }) }).catch(()=>{});
    }
    return;
  }
  const navBtn = e.target.closest && e.target.closest("#nav button[data-view]");
  if (navBtn) {
    showView(navBtn.dataset.view);
  }
});
const composer = $("#composer");
["dragenter","dragover"].forEach((evt) => {
  composer.addEventListener(evt, (e) => {
    e.preventDefault();
    composer.classList.add("drag-over");
  });
});
["dragleave","drop"].forEach((evt) => {
  composer.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "drop") {
      composer.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length || e.dataTransfer?.items?.length) {
        addDataTransfer(e.dataTransfer);
      }
    } else if (e.target === composer) {
      composer.classList.remove("drag-over");
    }
  });
});
$("#themeBtn").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("forge-theme", state.theme);
  applyTheme();
};
$("#newSessionBtn").onclick = async () => {
  state.sessionId = null;
  localStorage.removeItem("forge-session-id");
  chat.innerHTML = "";
  setEmptyVisible(true);
  showView("chat");
  try { await ensureSession({ forceNew: true }); } catch (e) { addChat("error", String(e), "event"); }
};

const commands = [
  { label: "New session", run: async () => { state.sessionId = null; localStorage.removeItem("forge-session-id"); chat.innerHTML=""; setEmptyVisible(true); await ensureSession({ forceNew: true }); showView("chat"); } },
  { label: "Open terminal", run: () => showView("terminal") },
  { label: "Open eval & traces", run: () => showView("traces") },
  { label: "Open tools", run: () => showView("tools") },
  { label: "Open approvals", run: () => showView("approvals") },
  { label: "Open gateway", run: () => showView("gateway") },
  { label: "Open memory", run: () => showView("memory") },
  { label: "Open models", run: () => showView("models") },
];
function openPalette() {
  $("#palette").classList.add("open");
  const items = $("#paletteItems");
  items.innerHTML = "";
  commands.forEach((c) => {
    const b = document.createElement("button");
    b.textContent = c.label;
    b.onclick = async () => { $("#palette").classList.remove("open"); await c.run(); };
    items.appendChild(b);
  });
  $("#paletteInput").value = "";
  $("#paletteInput").focus();
}
$("#paletteBtn") && ($("#paletteBtn").onclick = openPalette);
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  if (e.key === "Escape") $("#palette").classList.remove("open");
});

$("#mobile-tabs").onclick = (e) => {
  const btn = e.target.closest("button[data-mobile]");
  if (!btn) return;
  document.querySelectorAll("#mobile-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  if (btn.dataset.mobile === "nav") {
    $("#sidebar").classList.add("mobile-open");
  } else {
    $("#sidebar").classList.remove("mobile-open");
    showView(btn.dataset.mobile === "approvals" ? "approvals" : "chat");
  }
};

const es = new EventSource("/api/events/stream");
es.onmessage = (ev) => {
  try {
    const data = JSON.parse(ev.data);
    addLive(data.type, data.payload || {});
    if (data.type === "message.created" && data.payload?.role === "assistant" && data.payload?.text) {
      addChat("forge", data.payload.text);
    }
    if (data.type === "task.failed" || data.type === "task.completed" || data.type === "verification.completed") {
      state.lastForgeText = "";
      refreshMessages().catch(() => {});
    }
    if (data.type === "agent.started") {
      addChat("forge", "Working… (model + tools). This can take a minute.", "event");
    }
    if (data.type === "model.selected") {
      const p = data.payload || {};
      addLive("model", (p.local || p.mode || ""));
    }
    if (data.type === "model.usage") {
      const p = data.payload || {};
      addLive("usage", (p.provider || "") + "/" + (p.model || "") + " in=" + (p.promptTokens ?? "?") + " out=" + (p.completionTokens ?? "?"));
    }
    if (data.type === "log.error") {
      addLive("error", (data.payload && data.payload.message) || "error");
    }
    if (data.type === "terminal.output" && state.termReady) {
      const p = data.payload || {};
      if (p.error) termWrite('<span class="err">' + escapeHtml(String(p.error)) + "</span>");
    }
  } catch {}
};
es.onerror = () => { $("#onlinePill").textContent = "○ Reconnecting"; $("#onlinePill").classList.remove("online"); };
es.onopen = () => { $("#onlinePill").textContent = "● Online"; $("#onlinePill").classList.add("online"); };

ensureSession().then(refreshMessages).catch(e => addChat("error", String(e), "event"));
</script>
</body>
</html>`;
