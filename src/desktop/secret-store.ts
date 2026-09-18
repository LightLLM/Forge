/**
 * SecretStore — OS-backed when Electron safeStorage is available,
 * otherwise encrypted-at-rest file under app data (dev/test fallback).
 * Never returns stored secrets to renderer after save (API returns boolean only).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type SecretKey =
  | "openrouter_api_key"
  | "telegram_bot_token"
  | "slack_bot_token";

export interface SecretStore {
  set(key: SecretKey, value: string): void;
  /** Returns true if a non-empty secret exists — never the value. */
  has(key: SecretKey): boolean;
  /** Main-process only — never expose via preload. */
  get(key: SecretKey): string | null;
  delete(key: SecretKey): void;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(blob: Buffer): string;
}

function vaultPath(appDataDir: string): string {
  return join(appDataDir, "secrets.vault.json");
}

type VaultFile = Record<string, string>;

function readVault(path: string): VaultFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VaultFile;
  } catch {
    return {};
  }
}

function writeVault(path: string, data: VaultFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Electron safeStorage-backed store. */
export function createElectronSecretStore(
  appDataDir: string,
  safeStorage: SafeStorageLike,
): SecretStore {
  const path = vaultPath(appDataDir);
  return {
    set(key, value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("OS secure storage is unavailable");
      }
      const vault = readVault(path);
      vault[key] = safeStorage.encryptString(value).toString("base64");
      writeVault(path, vault);
    },
    has(key) {
      const vault = readVault(path);
      return Boolean(vault[key]);
    },
    get(key) {
      const vault = readVault(path);
      const blob = vault[key];
      if (!blob) return null;
      try {
        return safeStorage.decryptString(Buffer.from(blob, "base64"));
      } catch {
        return null;
      }
    },
    delete(key) {
      const vault = readVault(path);
      if (key in vault) {
        delete vault[key];
        writeVault(path, vault);
      }
    },
  };
}

/**
 * Dev/test fallback: AES-256-GCM with machine-local key file.
 * Not as strong as OS keychain — Electron safeStorage preferred in production.
 */
export function createFileSecretStore(appDataDir: string): SecretStore {
  const path = vaultPath(appDataDir);
  const keyPath = join(appDataDir, ".secret-key");

  function loadKey(): Buffer {
    if (existsSync(keyPath)) return readFileSync(keyPath);
    mkdirSync(dirname(keyPath), { recursive: true });
    const key = randomBytes(32);
    writeFileSync(keyPath, key);
    return key;
  }

  function encrypt(plain: string): string {
    const key = loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString("base64");
  }

  function decrypt(blob: string): string | null {
    try {
      const key = loadKey();
      const buf = Buffer.from(blob, "base64");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        "utf8",
      );
    } catch {
      return null;
    }
  }

  return {
    set(key, value) {
      const vault = readVault(path);
      vault[key] = encrypt(value);
      writeVault(path, vault);
    },
    has(key) {
      return Boolean(readVault(path)[key]);
    },
    get(key) {
      const blob = readVault(path)[key];
      if (!blob) return null;
      return decrypt(blob);
    },
    delete(key) {
      const vault = readVault(path);
      if (key in vault) {
        delete vault[key];
        writeVault(path, vault);
      }
      if (Object.keys(vault).length === 0 && existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Fingerprint for diagnostics — never a secret. */
export function secretFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
