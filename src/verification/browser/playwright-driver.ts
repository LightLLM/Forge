import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { BrowserDriver } from "./types.js";

/**
 * Resolve Playwright without a static import so typecheck/build work when
 * the optional package is not installed.
 */
type PlaywrightModule = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<{
      newContext: (options?: {
        viewport?: { width: number; height: number };
        baseURL?: string;
      }) => Promise<{
        newPage: () => Promise<{
          goto: (url: string, options?: { waitUntil?: string }) => Promise<unknown>;
          click: (selector: string) => Promise<unknown>;
          fill: (selector: string, text: string) => Promise<unknown>;
          locator: (selector: string) => { innerText: () => Promise<string> };
          url: () => string;
          screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
          on: (event: string, handler: (...args: unknown[]) => void) => void;
        }>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

/**
 * Resolve Playwright without a static import so typecheck/build work when
 * the optional package is not installed.
 */
async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("playwright");
    const mod = (await import(pathToFileURL(resolved).href)) as PlaywrightModule;
    return mod;
  } catch {
    return null;
  }
}

/**
 * Playwright-backed driver. Loaded dynamically so Forge works without Playwright installed.
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  readonly name = "playwright";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browser: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private page: any = null;
  private readonly consoles: string[] = [];
  private readonly networks: string[] = [];

  static async isAvailable(): Promise<boolean> {
    return (await loadPlaywright()) !== null;
  }

  async start(options: {
    baseUrl: string;
    viewport?: { width: number; height: number };
    artifactDir: string;
  }): Promise<void> {
    mkdirSync(options.artifactDir, { recursive: true });
    const playwright = await loadPlaywright();
    if (!playwright) {
      throw new Error(
        "Playwright is not installed. Install playwright to use the Playwright browser driver.",
      );
    }
    this.browser = await playwright.chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 720 },
      baseURL: options.baseUrl,
    });
    this.page = await context.newPage();
    this.page.on("console", (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") this.consoles.push(msg.text());
    });
    this.page.on(
      "requestfailed",
      (req: { url: () => string; failure: () => { errorText?: string } | null }) => {
        this.networks.push(
          `${req.url()} ${req.failure()?.errorText ?? "failed"}`,
        );
      },
    );
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.page.fill(selector, text);
  }

  async textContent(): Promise<string> {
    return (await this.page.locator("body").innerText()) as string;
  }

  async url(): Promise<string> {
    return this.page.url() as string;
  }

  async screenshot(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await this.page.screenshot({ path, fullPage: true });
  }

  consoleErrors(): string[] {
    return [...this.consoles];
  }

  networkFailures(): string[] {
    return [...this.networks];
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
