import type { PintaConfig } from "../core/config.js";
import type { BaseEvent } from "../core/types.js";
import type { GuardResult } from "../core/guard.js";
import { Transport } from "../core/transport.js";
import { TraceManager } from "../core/trace.js";
import { buildOtlpPayload } from "../core/otlp.js";

/**
 * Shared transport flow used by every handler: flush any queued payloads,
 * resolve the trace id, build the OTLP payload, send it.
 *
 * `traceMode` selects the trace boundary:
 *   - "current": reuse the session's in-flight trace (every mid-turn hook).
 *   - "new": rotate a fresh trace — only UserPromptSubmit, which marks the
 *     start of a new user turn.
 */
export async function emitEvent(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new"; guard?: GuardResult | null } = {},
): Promise<void> {
  const transport = new Transport(config);
  await transport.flush();

  const traces = new TraceManager(config);
  const traceId = opts.traceMode === "new" ? traces.newTrace() : traces.currentTrace();
  const payload = buildOtlpPayload({ event, traceId, guard: opts.guard });
  await transport.send(payload);
}

/**
 * Telemetry is always best-effort. Its failure must never override a security
 * decision that has already been written, nor fail the hook.
 */
export async function emitBestEffort(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new"; guard?: GuardResult | null } = {},
): Promise<void> {
  try {
    await emitEvent(event, config, opts);
  } catch (err) {
    process.stderr.write(`[pinta-musecode] telemetry emit failed: ${err}\n`);
  }
}
