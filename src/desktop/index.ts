/** Desktop module barrel — lifecycle/settings only, no agent loop. */

export {
  DEFAULT_DESKTOP_SETTINGS,
  defaultAppDataDir,
  loadDesktopSettings,
  saveDesktopSettings,
  settingsPath,
  type DesktopSettings,
  type RoutingMode,
} from "./app-settings.js";
export {
  createElectronSecretStore,
  createFileSecretStore,
  secretFingerprint,
  type SecretKey,
  type SecretStore,
} from "./secret-store.js";
export { detectOllama, type OllamaDetection } from "./ollama-detect.js";
export {
  startInProcessRuntime,
  isPortReachable,
  assertCanBindLoopback,
  type RuntimeHandle,
} from "./runtime-host.js";
export { RuntimeSupervisor } from "./supervisor.js";
export {
  buildStartArgs,
  pickLoopbackPort,
  resolveForgeRoot,
  resolveForgeStartCommand,
  startForgeSidecar,
  waitForGateway,
  type SidecarHandle,
} from "./sidecar.js";
