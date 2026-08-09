// Muse-specific binding over the shared TraceManager in @pinta-ai/core.
import { TraceManager as CoreTraceManager } from "@pinta-ai/core";
import type { PintaConfig } from "./config.js";

export class TraceManager extends CoreTraceManager {
  constructor(config: PintaConfig) {
    super(config.tracePath);
  }
}
