export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "assertText"
  | "assertUrl"
  | "screenshot"
  | "waitForText";

export interface BrowserAction {
  type: BrowserActionType;
  /** CSS selector, URL, or text depending on action. */
  target?: string;
  value?: string;
  /** Assertion expectation */
  expected?: string;
  name?: string;
}

export interface BrowserScenario {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  viewport?: { width: number; height: number };
  actions: BrowserAction[];
}

export interface BrowserStepResult {
  action: BrowserAction;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface BrowserQaResult {
  scenarioId: string;
  status: "passed" | "failed" | "skipped";
  steps: BrowserStepResult[];
  consoleErrors: string[];
  networkFailures: string[];
  screenshots: string[];
  summary: string;
  driver: string;
}

export interface BrowserDriver {
  readonly name: string;
  start(options: {
    baseUrl: string;
    viewport?: { width: number; height: number };
    artifactDir: string;
  }): Promise<void>;
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  textContent(): Promise<string>;
  url(): Promise<string>;
  screenshot(path: string): Promise<void>;
  consoleErrors(): string[];
  networkFailures(): string[];
  close(): Promise<void>;
}
