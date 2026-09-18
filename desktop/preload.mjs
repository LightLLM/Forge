/**
 * Preload — DESKTOP-1.
 * Expose a narrow, typed API only. Never shell/FS/env.
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("forgeDesktop", {
  version: "1.1.0-rc.1",
  shell: "electron",
});
