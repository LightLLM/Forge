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

// Consistent app-data folder: %APPDATA%/Forge (not forge-desktop)
app.setName("Forge");

/** Tiny 32x32 PNG so Windows Tray is valid (empty icons break tray/dialogs). */
const TRAY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALElEQVRYR+3YIQ4AMAgEwbz/0tWmQYIEzMzW7J4C8P8KioqKioqKioqKioqK+gcPWwABMQz2VwAAAABJRU5ErkJggg==";

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {any} */
let supervisor = null;
/** @type {any} */
let secrets = null;
/** @type {any} */
let desktopMod = null;
let shuttingDown = false;
let allowBackground = false;
/** @type {string} */
let appDataDir = "";
/** @type {any} */
let settings = null;
/** @type {string | null} */
let gatewayBaseUrl = null;

function forgeModule() {
  const distIndex = join(resolveForgeRepoRoot(), "dist", "desktop", "index.js");
  if (existsSync(distIndex)) {
    return import(pathToFileURL(distIndex).href);
  }
  throw new Error(
    `Forge desktop modules missing at ${distIndex}. Reinstall Forge or run pnpm build.`,
  );
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
    if (!appDataDir) appDataDir = app.getPath("userData");
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
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Forge",
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
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
  try {
    const n = new Notification({ title, body });
    n.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    n.show();
  } catch {
    /* ignore */
  }
}

function ensureTray() {
  if (tray) return;
  try {
    const icon = nativeImage.createFromDataURL(TRAY_PNG);
    if (icon.isEmpty()) {
      logLine("tray icon empty — skipping tray");
      return;
    }
    tray = new Tray(icon);
    tray.setToolTip("Forge");
    tray.setContextMenu(buildAppMenu(true));
    tray.on("double-click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch (err) {
    logLine(`tray failed: ${err}`);
  }
}

function buildAppMenu(forTray = false) {
  const items = [
    {
      label: "Open Forge",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "Open Project…",
      click: () => {
        void changeProjectFromUi();
      },
    },
    { type: "separator" },
    {
      label: "Open logs",
      click: () => {
        const log = join(appDataDir || app.getPath("userData"), "desktop.log");
        if (!existsSync(log)) writeFileSync(log, "", "utf8");
        shell.showItemInFolder(log);
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
  ];
  return forTray
    ? Menu.buildFromTemplate(items)
    : Menu.buildFromTemplate([
        { label: "File", submenu: items },
        {
          label: "Edit",
          submenu: [
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
      ]);
}

async function pickProjectDirectory() {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
  const opts = {
    title: "Select a local project folder",
    buttonLabel: "Open Project",
    properties: ["openDirectory"],
  };
  const res = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths?.[0]) return null;
  return res.filePaths[0];
}

function syncProviderEnv(workspacePath) {
  const key = secrets?.get("openrouter_api_key");
  if (key) {
    process.env.OPENROUTER_API_KEY = key;
  }
  if (settings?.routingMode) {
    process.env.FORGE_MODE = settings.routingMode;
  }
  if (settings?.localModel) {
    process.env.OLLAMA_MODEL = settings.localModel;
    process.env.FORGE_LOCAL_MODEL = settings.localModel;
  }
  if (settings?.cloudModel) {
    process.env.OPENROUTER_MODEL = settings.cloudModel;
    process.env.FORGE_CLOUD_MODEL = settings.cloudModel;
  }
  if (settings?.ollamaBaseUrl) {
    process.env.OLLAMA_BASE_URL = settings.ollamaBaseUrl;
  }
  try {
    const forgeDir = join(workspacePath, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const lines = [];
    if (settings?.localModel) {
      lines.push(`OLLAMA_MODEL=${settings.localModel}`);
      lines.push(`FORGE_LOCAL_MODEL=${settings.localModel}`);
    }
    if (settings?.cloudModel) {
      lines.push(`OPENROUTER_MODEL=${settings.cloudModel}`);
      lines.push(`FORGE_CLOUD_MODEL=${settings.cloudModel}`);
    }
    if (settings?.routingMode) lines.push(`FORGE_MODE=${settings.routingMode}`);
    if (settings?.ollamaBaseUrl) lines.push(`OLLAMA_BASE_URL=${settings.ollamaBaseUrl}`);
    if (key) lines.push(`OPENROUTER_API_KEY=${key}`);
    writeFileSync(join(forgeDir, "desktop.env"), lines.join("\n") + "\n", "utf8");
  } catch (err) {
    logLine(`env sync skipped: ${err}`);
  }
}

async function startRuntime(workspacePath) {
  const mod = desktopMod || (await forgeModule());
  desktopMod = mod;
  const forgeRoot = resolveForgeRepoRoot();
  /** @type {import('node:child_process').ChildProcess | null} */
  let childProc = null;

  if (supervisor) {
    try {
      await supervisor.stop();
    } catch {
      /* ignore */
    }
    supervisor = null;
  }

  syncProviderEnv(workspacePath);

  const start = async () => {
    // Prefer child process so agent/model work cannot freeze the Electron UI thread.
    // Opt into in-process only with FORGE_DESKTOP_INPROCESS=1.
    if (process.env.FORGE_DESKTOP_INPROCESS === "1") {
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
      env: {
        ...(process.env.OPENROUTER_API_KEY
          ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
          : {}),
        ...(process.env.OPENROUTER_MODEL
          ? { OPENROUTER_MODEL: process.env.OPENROUTER_MODEL }
          : {}),
        ...(process.env.OLLAMA_MODEL ? { OLLAMA_MODEL: process.env.OLLAMA_MODEL } : {}),
        ...(process.env.FORGE_MODE ? { FORGE_MODE: process.env.FORGE_MODE } : {}),
        ...(process.env.FORGE_LOCAL_MODEL
          ? { FORGE_LOCAL_MODEL: process.env.FORGE_LOCAL_MODEL }
          : {}),
        ...(process.env.OLLAMA_BASE_URL
          ? { OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL }
          : {}),
      },
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
  logLine(`runtime ready workspace=${workspacePath} url=${runtime.baseUrl}`);

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

async function changeProjectFromUi() {
  try {
    const path = await pickProjectDirectory();
    if (!path) return;
    if (!desktopMod || !settings) return;
    settings = {
      ...desktopMod.DEFAULT_DESKTOP_SETTINGS,
      ...settings,
      onboardingComplete: true,
      workspacePath: path,
      version: 1,
    };
    desktopMod.saveDesktopSettings(appDataDir, settings);
    await mainWindow?.loadFile(join(__dirname, "loading.html"));
    const runtime = await startRuntime(path);
    await mainWindow?.loadURL(runtime.baseUrl + "/");
    notify("Forge", `Opened project: ${path}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLine(`changeProject failed: ${msg}`);
    dialog.showErrorBox("Forge", `Could not open project:\n${msg}`);
  }
}

async function loadAppUi() {
  if (!settings?.onboardingComplete || !settings.workspacePath) {
    logLine("showing onboarding");
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
         <p>Use <strong>File → Open Project…</strong> to choose another folder.</p>
         </body>`,
      )}`,
    );
  }
}

function registerIpc(mod) {
  ipcMain.handle("forge:getSettings", () => ({
    ...settings,
    hasOpenRouterKey: secrets?.has("openrouter_api_key") ?? false,
    appDataDir,
    version: app.getVersion(),
    gatewayBaseUrl,
  }));

  ipcMain.handle("forge:pickProject", async () => {
    try {
      return await pickProjectDirectory();
    } catch (err) {
      logLine(`pickProject error: ${err}`);
      throw err;
    }
  });

  ipcMain.handle("forge:pickFolder", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showOpenDialog(win ?? undefined, {
      title: "Select folder",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths?.[0]) return null;
    return res.filePaths[0];
  });

  ipcMain.handle("forge:pickFiles", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showOpenDialog(win ?? undefined, {
      title: "Select files",
      properties: ["openFile", "multiSelections"],
    });
    if (res.canceled || !res.filePaths?.length) return [];
    return res.filePaths;
  });

  ipcMain.handle("forge:detectOllama", async (_e, baseUrl) =>
    mod.detectOllama(baseUrl || settings?.ollamaBaseUrl),
  );

  ipcMain.handle("forge:saveOnboarding", async (_e, payload) => {
    if (!payload?.workspacePath) {
      throw new Error("No project folder selected");
    }
    settings = {
      ...mod.DEFAULT_DESKTOP_SETTINGS,
      ...settings,
      onboardingComplete: true,
      workspacePath: payload.workspacePath,
      routingMode: payload.routingMode || "local-preferred",
      localModel: payload.localModel || null,
      cloudModel: payload.cloudModel || null,
      ollamaBaseUrl: payload.ollamaBaseUrl || "http://127.0.0.1:11434",
      runInBackground: Boolean(payload.runInBackground),
      version: 1,
    };
    allowBackground = settings.runInBackground;
    mod.saveDesktopSettings(appDataDir, settings);
    logLine(`onboarding saved workspace=${settings.workspacePath}`);

    if (payload.openRouterApiKey) {
      secrets.set("openrouter_api_key", String(payload.openRouterApiKey));
    }

    await mainWindow.loadFile(join(__dirname, "loading.html"));
    const runtime = await startRuntime(settings.workspacePath);
    await mainWindow.loadURL(runtime.baseUrl + "/");
    return { ok: true, workspacePath: settings.workspacePath };
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
      forgeCore:
        existsSync(join(resolveForgeRepoRoot(), "dist", "cli", "index.js")) ||
        app.isPackaged,
      database: true,
      git: true,
      ollama: ollama.ok,
      ollamaDetail: ollama.detail,
      openRouter: secrets?.has("openrouter_api_key") ?? false,
      gateway: Boolean(gatewayBaseUrl),
      appDataDir,
      workspacePath: settings?.workspacePath ?? null,
    };
  });

  ipcMain.handle("forge:checkForUpdates", async () => ({
    ok: true,
    updateAvailable: false,
    version: null,
    detail: "Updater checks disabled until a signed GitHub Release exists",
  }));
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
  appDataDir = app.getPath("userData");
  mkdirSync(appDataDir, { recursive: true });
  logLine(`app ready packaged=${app.isPackaged} userData=${appDataDir}`);

  try {
    desktopMod = await forgeModule();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLine(`forgeModule failed: ${msg}`);
    createMainWindow();
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(
        `<!doctype html><meta charset=utf-8><title>Forge</title>
         <body style="font-family:system-ui;background:#0f1216;color:#e6edf3;padding:2rem">
         <h1>Forge failed to start</h1>
         <pre style="color:#f07178;white-space:pre-wrap">${msg.replace(/[<>&]/g, "")}</pre>
         </body>`,
      )}`,
    );
    return;
  }

  const mod = desktopMod;
  settings = mod.loadDesktopSettings(appDataDir);
  allowBackground = Boolean(settings.runInBackground);
  logLine(
    `settings onboarding=${settings.onboardingComplete} workspace=${settings.workspacePath}`,
  );

  if (safeStorage.isEncryptionAvailable()) {
    secrets = mod.createElectronSecretStore(appDataDir, safeStorage);
  } else {
    secrets = mod.createFileSecretStore(appDataDir);
    logLine("safeStorage unavailable — using file SecretStore fallback");
  }

  registerIpc(mod);
  Menu.setApplicationMenu(buildAppMenu(false));
  ensureTray();
  createMainWindow();
  await loadAppUi();

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
