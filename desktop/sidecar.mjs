/**
 * Re-export Core desktop sidecar helpers for Electron main.
 * Requires `pnpm build` so ../dist/desktop/sidecar.js exists.
 */
export {
  buildStartArgs,
  pickLoopbackPort,
  resolveForgeRoot,
  resolveForgeStartCommand,
  startForgeSidecar,
  waitForGateway,
} from "../dist/desktop/sidecar.js";
