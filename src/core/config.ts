import os from "node:os";
import path from "node:path";

/**
 * Adapter config — only the bits we actually use. The OTLP endpoint and headers
 * come from the standard `OTEL_EXPORTER_OTLP_*` env vars, which the manager
 * writes into `~/.config/muse/pinta-musecode.env` (see src/env-file.ts).
 *
 * Muse Code has no plugin system and therefore no `*_PLUGIN_ROOT` equivalent, so
 * the state directory is resolved from our own env var with a `~/.pinta` default.
 * It deliberately does NOT live under the workspace: Muse Code treats `.muse`,
 * `.git` and `.agents` as read-only even inside an otherwise writable workspace
 * (dev.meta.ai/docs/muse-code/permissions).
 */
export interface PintaConfig {
  pluginData: string;
  tracePath: string;
}

export function pluginDataDir(): string {
  return (
    process.env.PINTA_MUSECODE_DATA ||
    process.env.PINTA_PLUGIN_DATA ||
    path.join(os.homedir(), ".pinta", "adaptors", "pinta-musecode")
  );
}

export function loadConfig(): PintaConfig {
  const pluginData = pluginDataDir();
  return {
    pluginData,
    tracePath: path.join(pluginData, "trace.json"),
  };
}

/** True when an OTLP endpoint is configured; otherwise telemetry silently no-ops. */
export function hasOtlpEndpoint(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
}

/**
 * Enforcement switch. Default OFF = shadow mode: the guard is still queried and
 * its verdict still recorded, but a DENY is never written back to the host.
 *
 * This is the plan's staged rollout (§10 stage 2) expressed in code, and it is
 * also what makes stage 1 safe while the deny wire format is still unconfirmed
 * (see src/core/decision.ts).
 */
export function isEnforcing(): boolean {
  return process.env.PINTA_MUSE_ENFORCE === "1";
}

/** Opt-in for the chatty per-LLM-call events. See types.ts isLlmCallEvent(). */
export function llmEventsEnabled(): boolean {
  return process.env.PINTA_MUSE_LLM_EVENTS === "1";
}
