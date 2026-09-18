/**
 * Desktop application settings stored under the OS app-data directory.
 * Does not store API secrets — those go through SecretStore.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type RoutingMode = "local-only" | "local-preferred" | "cloud-allowed";

export interface DesktopSettings {
  version: 1;
  onboardingComplete: boolean;
  workspacePath: string | null;
  routingMode: RoutingMode;
  localModel: string | null;
  runInBackground: boolean;
  ollamaBaseUrl: string;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  version: 1,
  onboardingComplete: false,
  workspacePath: null,
  routingMode: "local-preferred",
  localModel: null,
  runInBackground: false,
  ollamaBaseUrl: "http://127.0.0.1:11434",
};

/** Platform-standard app data root (without Electron APIs — testable). */
export function defaultAppDataDir(productName = "Forge"): string {
  const home = homedir();
  if (process.platform === "win32") {
    const base = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(base, productName);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", productName);
  }
  const xdg = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(xdg, productName);
}

export function settingsPath(appDataDir: string): string {
  return join(appDataDir, "desktop-settings.json");
}

export function loadDesktopSettings(appDataDir: string): DesktopSettings {
  const path = settingsPath(appDataDir);
  if (!existsSync(path)) return { ...DEFAULT_DESKTOP_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DesktopSettings>;
    return {
      ...DEFAULT_DESKTOP_SETTINGS,
      ...raw,
      version: 1,
    };
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS };
  }
}

export function saveDesktopSettings(
  appDataDir: string,
  settings: DesktopSettings,
): void {
  const path = settingsPath(appDataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
