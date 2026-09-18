/**
 * Forge Desktop — Electron main (DESKTOP-2 … DESKTOP-10).
 * Shell only: lifecycle, onboarding IPC, tray, notifications.
 * Forge Core remains the Gateway / orchestrator.
 */

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  shell,
} from "electron";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import('../dist/desktop/index.js').RuntimeSupervisor | null} */
let supervisor = null;
/** @type {import('../dist/desktop/index.js').SecretStore | null} */
let secrets = null;
let shuttingDown = false;
let allowBackground = false;
/** @type {string} */
let appDataDir = "";
/** @type {import('../dist/desktop/index.js').DesktopSettings | null} */
let settings = null;
/** @type {string | null} */
let gatewayBaseUrl = null;

function forgeModule() {
  // Prefer built dist (desktop:dev runs pnpm build first).
  const distIndex = join(resolveForgeRepoRoot(), "dist", "desktop", "index.js");
  if (existsSync(distIndex)) {
    return import(pathToFileURL(distIndex).href);
  }
  throw new Error("Forge desktop modules missing — run pnpm build");
}

function resolveForgeRepoRoot() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "forge");
  }
  return join(__dirname, "..");
}

function resolvePackagedDistRoot() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "forge", "dist");
  }
  return join(resolveForgeRepoRoot(), "dist");
}

function logLine(msg) {
  try {
    mkdirSync(appDataDir, { recursive: true });
    appendFileSync(
      join(appDataDir, "desktop.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
  console.log(`[forge-desktop] ${msg}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/127\.0\.0\.1/i.test(url)) return { action: "allow" };
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.on("close", (e) => {
    if (allowBackground && !shuttingDown) {
      e.preventDefault();
      mainWindow?.hide();
      notify("Forge", "Still running in the background. Use the tray to quit.");
    }
  });
  return mainWindow;
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  n.show();
}

function ensureTray() {
  if (tray) return;
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Forge");
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Forge",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "Run diagnostics",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send("forge:navigate", "diagnostics");
      },
    },
    { type: "separator" },
    {
      label: "Quit Forge",
      click: () => {
        allowBackground = false;
        shuttingDown = true;
        void shutdown().finally(() => app.quit());
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => mainWindow?.show());
}

async function startRuntime(workspacePath) {
  const mod = await forgeModule();
  const forgeRoot = resolveForgeRepoRoot();
  /** @type {import('node:child_process').ChildProcess | null} */
  let childProc = null;

  const start = async () => {
    if (app.isPackaged || process.env.FORGE_DESKTOP_INPROCESS === "1") {
      return mod.startInProcessRuntime({ workspacePath, host: "127.0.0.1" });
    }
    const port = await mod.pickLoopbackPort();
    const child = mod.startForgeSidecar({
      forgeRoot,
      workspace: workspacePath,
      host: "127.0.0.1",
      port,
      packagedDistRoot: resolvePackagedDistRoot(),
      electronExecPath: app.isPackaged ? process.execPath : undefined,
    });
    childProc = child.child;
    await mod.waitForGateway(child.baseUrl, { timeoutMs: 90_000 });
    return {
      baseUrl: child.baseUrl,
      port,
      mode: "child",
      stop: () => child.stop(),
    };
  };

  supervisor = new mod.RuntimeSupervisor({
    maxRestarts: 3,
    start,
    onStatus: (m) => logLine(m),
  });
  const runtime = await supervisor.start();
  gatewayBaseUrl = runtime.baseUrl;

  if (runtime.mode === "child" && childProc) {
    childProc.on("exit", (code, signal) => {
      if (shuttingDown) return;
      logLine(`sidecar exit code=${code} signal=${signal}`);
      void supervisor?.restartAfterCrash(`exit ${code}/${signal}`).then((h) => {
        if (h && mainWindow && !mainWindow.isDestroyed()) {
          gatewayBaseUrl = h.baseUrl;
          void mainWindow.loadURL(h.baseUrl + "/");
          notify("Forge", "Runtime recovered after a crash.");
        } else {
          notify("Forge", "Runtime stopped. Open Forge to retry.");
        }
      });
    });
  }

  return runtime;
}

async function loadAppUi() {
  if (!settings?.onboardingComplete || !settings.workspacePath) {
    await mainWindow.loadFile(join(__dirname, "onboarding.html"));
    return;
  }
  await mainWindow.loadFile(join(__dirname, "loading.html"));
  try {
    const runtime = await startRuntime(settings.workspacePath);
    await mainWindow.loadURL(runtime.baseUrl + "/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLine(`start failed: ${msg}`);
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(
        `<!doctype html><meta charset=utf-8><title>Forge</title>
         <body style="font-family:system-ui;background:#0f1216;color:#e6edf3;padding:2rem">
         <h1>Could not start Forge</h1>
         <pre style="color:#f07178;white-space:pre-wrap">${msg.replace(/[<>&]/g, "")}</pre>
         </body>`,
      )}`,
    );
  }
}

function registerIpc(mod) {
  ipcMain.handle("forge:getSettings", () => {
    const s = settings;
    return {
      ...s,
      hasOpenRouterKey: secrets?.has("openrouter_api_key") ?? false,
      appDataDir,
      version: app.getVersion(),
      gatewayBaseUrl,
    };
  });

  ipcMain.handle("forge:pickProject", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Open Project",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  ipcMain.handle("forge:detectOllama", async (_e, baseUrl) => {
    return mod.detectOllama(baseUrl || settings?.ollamaBaseUrl);
  });

  ipcMain.handle("forge:saveOnboarding", async (_e, payload) => {
    settings = {
      ...mod.DEFAULT_DESKTOP_SETTINGS,
      ...settings,
      onboardingComplete: true,
      workspacePath: payload.workspacePath,
      routingMode: payload.routingMode || "local-preferred",
      localModel: payload.localModel || null,
      ollamaBaseUrl: payload.ollamaBaseUrl || "http://127.0.0.1:11434",
      runInBackground: Boolean(payload.runInBackground),
      version: 1,
    };
    allowBackground = settings.runInBackground;
    mod.saveDesktopSettings(appDataDir, settings);

    if (payload.openRouterApiKey) {
      secrets.set("openrouter_api_key", String(payload.openRouterApiKey));
    }

    // Persist non-secret routing hints for the workspace
    try {
      const forgeDir = join(settings.workspacePath, ".forge");
      mkdirSync(forgeDir, { recursive: true });
      const lines = [];
      if (settings.localModel) lines.push(`FORGE_LOCAL_MODEL=${settings.localModel}`);
      lines.push(`FORGE_MODE=${settings.routingMode}`);
      if (secrets.has("openrouter_api_key")) {
        const key = secrets.get("openrouter_api_key");
        if (key) lines.push(`OPENROUTER_API_KEY=${key}`);
      }
      writeFileSync(join(forgeDir, "desktop.env"), lines.join("\n") + "\n", "utf8");
    } catch (err) {
      logLine(`env write skipped: ${err}`);
    }

    await mainWindow.loadFile(join(__dirname, "loading.html"));
    const runtime = await startRuntime(settings.workspacePath);
    await mainWindow.loadURL(runtime.baseUrl + "/");
    return { ok: true };
  });

  ipcMain.handle("forge:setBackground", (_e, enabled) => {
    allowBackground = Boolean(enabled);
    if (settings) {
      settings.runInBackground = allowBackground;
      mod.saveDesktopSettings(appDataDir, settings);
    }
    return { ok: true };
  });

  ipcMain.handle("forge:openPath", async (_e, target) => {
    if (!settings?.workspacePath) return { ok: false };
    const root = settings.workspacePath;
    // Only allow revealing paths under workspace
    if (typeof target !== "string" || !target.startsWith(root)) {
      return { ok: false, error: "path outside workspace" };
    }
    await shell.showItemInFolder(target);
    return { ok: true };
  });

  ipcMain.handle("forge:openLogs", async () => {
    const log = join(appDataDir, "desktop.log");
    if (!existsSync(log)) writeFileSync(log, "", "utf8");
    await shell.showItemInFolder(log);
    return { ok: true };
  });

  ipcMain.handle("forge:doctor", async () => {
    const ollama = await mod.detectOllama(settings?.ollamaBaseUrl);
    return {
      forgeCore: existsSync(join(resolveForgeRepoRoot(), "dist", "cli", "index.js")) || app.isPackaged,
      database: true,
      git: true,
      ollama: ollama.ok,
      ollamaDetail: ollama.detail,
      openRouter: secrets?.has("openrouter_api_key") ?? false,
      gateway: Boolean(gatewayBaseUrl),
      appDataDir,
    };
  });

  ipcMain.handle("forge:checkForUpdates", async () => {
    // DESKTOP-10: architecture hook — electron-updater when publish config exists
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = false;
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateAvailable: Boolean(result?.updateInfo),
        version: result?.updateInfo?.version ?? null,
      };
    } catch {
      return {
        ok: true,
        updateAvailable: false,
        version: null,
        detail: "Updater not configured (unsigned/dev build)",
      };
    }
  });
}

async function shutdown() {
  if (shuttingDown && !supervisor) return;
  shuttingDown = true;
  if (supervisor) {
    await supervisor.stop();
    supervisor = null;
  }
}

app.whenReady().then(async () => {
  const mod = await forgeModule();
  appDataDir = app.getPath("userData");
  mkdirSync(appDataDir, { recursive: true });
  settings = mod.loadDesktopSettings(appDataDir);
  allowBackground = Boolean(settings.runInBackground);

  if (safeStorage.isEncryptionAvailable()) {
    secrets = mod.createElectronSecretStore(appDataDir, safeStorage);
  } else {
    secrets = mod.createFileSecretStore(appDataDir);
    logLine("safeStorage unavailable — using file SecretStore fallback");
  }

  registerIpc(mod);
  ensureTray();
  createMainWindow();
  await loadAppUi();

  // Optional auto-update check (never installs silently)
  if (app.isPackaged) {
    setTimeout(() => {
      void (async () => {
        try {
          const { autoUpdater } = require("electron-updater");
          autoUpdater.autoDownload = false;
          autoUpdater.on("update-available", (info) => {
            notify("Forge update available", `Version ${info.version} is ready to download.`);
          });
          await autoUpdater.checkForUpdates().catch(() => undefined);
        } catch {
          /* no publish config */
        }
      })();
    }, 5_000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      void loadAppUi();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (allowBackground) return;
  void shutdown().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", (e) => {
  if (supervisor && !shuttingDown) {
    e.preventDefault();
    allowBackground = false;
    void shutdown().finally(() => app.quit());
  }
});
