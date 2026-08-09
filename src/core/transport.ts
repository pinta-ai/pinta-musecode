// Muse-specific binding over the shared DiskTransport in @pinta-ai/core.
// Endpoint/headers resolve from the standard OTEL_EXPORTER_OTLP_* env vars
// (the shared envOptionsResolver default), which the env file populates at
// startup.
import { DiskTransport } from "@pinta-ai/core";
import type { PintaConfig } from "./config.js";

export class Transport extends DiskTransport {
  constructor(config: PintaConfig) {
    super({ pluginData: config.pluginData, logPrefix: "pinta-musecode" });
  }
}
