/**
 * Preload — narrow typed IPC only (DESKTOP-3 security boundary).
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("forgeDesktop", {
  version: "1.2.0-rc.1",
  shell: "electron",
  getSettings: () => ipcRenderer.invoke("forge:getSettings"),
  pickProject: () => ipcRenderer.invoke("forge:pickProject"),
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
