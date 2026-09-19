import type { OtlpPayload } from "@pinta-ai/core";
import type { PintaConfig } from "../core/config.js";
import type { BaseEvent } from "../core/types.js";
import { Transport } from "../core/transport.js";
import { TraceManager } from "../core/trace.js";
import { buildOtlpPayload } from "../core/otlp.js";

/**
 * The span for a hook event, before anything has been decided about it.
 *
 * Split out of `emitEvent` so the gating handler can build the payload, ask the
 * guard about that very object, attach the verdict, and then send it — the
 * manager judges the span the backend will store, not a second reading of the
 * event.
 *
 * `traceMode` selects the trace boundary:
 *   - "current": reuse the session's in-flight trace (every mid-turn hook).
 *   - "new": rotate a fresh trace — only UserPromptSubmit, which marks the
 *     start of a new user turn.
 */
export function buildEventPayload(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new" } = {},
): OtlpPayload {
  const traces = new TraceManager(config);
  const traceId = opts.traceMode === "new" ? traces.newTrace() : traces.currentTrace();
  return buildOtlpPayload({ event, traceId });
}

/** Flush any queued payloads, then send this one. */
export async function sendPayload(payload: OtlpPayload, config: PintaConfig): Promise<void> {
  const transport = new Transport(config);
  await transport.flush();
  await transport.send(payload);
}

/**
 * Shared transport flow used by every non-gating handler: resolve the trace
 * id, build the OTLP payload, flush the queue, send it.
 */
export async function emitEvent(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new" } = {},
): Promise<void> {
  await sendPayload(buildEventPayload(event, config, opts), config);
}

/**
 * Telemetry is always best-effort. Its failure must never override a security
 * decision that has already been written, nor fail the hook.
 */
export async function emitBestEffort(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new" } = {},
): Promise<void> {
  try {
    await emitEvent(event, config, opts);
  } catch (err) {
    process.stderr.write(`[pinta-musecode] telemetry emit failed: ${err}\n`);
  }
}

/** `sendPayload`, best-effort — for a span that was built and judged earlier. */
export async function sendBestEffort(payload: OtlpPayload, config: PintaConfig): Promise<void> {
  try {
    await sendPayload(payload, config);
  } catch (err) {
    process.stderr.write(`[pinta-musecode] telemetry emit failed: ${err}\n`);
  }
}
