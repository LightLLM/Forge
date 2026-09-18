/**
 * Preload (CommonJS) — required for Electron sandbox in packaged builds.
 * ESM preload.mjs often fails to load inside asar + sandbox.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("forgeDesktop", {
  version: "1.2.0-rc.2",
  shell: "electron",
  getSettings: () => ipcRenderer.invoke("forge:getSettings"),
  pickProject: () => ipcRenderer.invoke("forge:pickProject"),
  pickFolder: () => ipcRenderer.invoke("forge:pickFolder"),
  pickFiles: () => ipcRenderer.invoke("forge:pickFiles"),
  detectOllama: (baseUrl) => ipcRenderer.invoke("forge:detectOllama", baseUrl),
  saveOnboarding: (payload) => ipcRenderer.invoke("forge:saveOnboarding", payload),
  setBackground: (enabled) => ipcRenderer.invoke("forge:setBackground", enabled),
  openLogs: () => ipcRenderer.invoke("forge:openLogs"),
  doctor: () => ipcRenderer.invoke("forge:doctor"),
  checkForUpdates: () => ipcRenderer.invoke("forge:checkForUpdates"),
  onNavigate: (cb) => {
    ipcRenderer.on("forge:navigate", (_e, view) => cb(view));
  },
});
