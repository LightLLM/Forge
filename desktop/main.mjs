/**
 * Forge Desktop — Electron main (DESKTOP-1).
 * Embeds the existing Gateway GUI in a native window.
 * Users never open an external browser or manage ports.
 */

import { app, BrowserWindow, shell } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickLoopbackPort,
  resolveForgeRoot,
  startForgeSidecar,
  waitForGateway,
} from "./sidecar.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Awaited<ReturnType<typeof startForgeSidecar>> | null} */
let sidecar = null;
let shuttingDown = false;

function workspacePath() {
  return (
    process.env.FORGE_WORKSPACE ||
    process.env.FORGE_DESKTOP_WORKSPACE ||
    resolveForgeRoot()
  );
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Forge",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Never open external browsers for primary UI navigation.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("https://127.0.0.1")) {
      return { action: "allow" };
    }
    // Allow opening docs/links in OS browser only for http(s) non-loopback.
    if (/^https?:/i.test(url) && !/127\.0\.0\.1|localhost/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  await mainWindow.loadFile(join(__dirname, "loading.html"));

  const forgeRoot = resolveForgeRoot();
  const workspace = workspacePath();
  const port = await pickLoopbackPort();

  sidecar = startForgeSidecar({
    forgeRoot,
    workspace,
    host: "127.0.0.1",
    port,
  });

  sidecar.child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `Forge sidecar exited unexpectedly (code=${code}, signal=${signal})`,
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(
        `data:text/html,${encodeURIComponent(
          `<!doctype html><meta charset=utf-8><title>Forge</title>
           <body style="font-family:system-ui;background:#0f1216;color:#e6edf3;display:grid;place-items:center;height:100vh">
           <div><h1>Forge runtime stopped</h1><p>The local sidecar exited. Restart the app.</p></div></body>`,
        )}`,
      );
    }
  });

  try {
    await waitForGateway(sidecar.baseUrl, { timeoutMs: 90_000 });
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(sidecar.baseUrl + "/");
    }
  } catch (err) {
    const logs = sidecar.getLogs();
    console.error("Gateway failed to start", err);
    console.error(logs.stderr || logs.stdout);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const msg = err instanceof Error ? err.message : String(err);
      await mainWindow.loadURL(
        `data:text/html,${encodeURIComponent(
          `<!doctype html><meta charset=utf-8><title>Forge</title>
           <body style="font-family:system-ui;background:#0f1216;color:#e6edf3;padding:2rem">
           <h1>Could not start Forge</h1>
           <pre style="white-space:pre-wrap;color:#f07178">${msg.replace(/[<>&]/g, "")}</pre>
           <p>Check that Node 22+ is available and run <code>pnpm build</code> in the Forge repo.</p>
           </body>`,
        )}`,
      );
    }
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (sidecar) {
    await sidecar.stop();
    sidecar = null;
  }
}

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  void shutdown().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", (e) => {
  if (sidecar && !shuttingDown) {
    e.preventDefault();
    void shutdown().finally(() => app.quit());
  }
});
