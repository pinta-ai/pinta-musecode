import { attachGuard } from "@pinta-ai/core";
import { isEnforcing, type PintaConfig } from "../core/config.js";
import type { ToolEvent } from "../core/types.js";
import { isInternalTool } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { writeDeny } from "../core/decision.js";
import { buildEventPayload, emitBestEffort, sendBestEffort } from "./shared.js";

/**
 * Handles both pre-action events: `PreToolUse` (fires for every tool) and
 * `PermissionRequest` (fires only where the host would prompt a human). They
 * share this path because both can block and both carry a tool payload.
 *
 * Ordering is load-bearing:
 *   1. exempt internal control tools,
 *   2. build the span, ask the guard about it,
 *   3. write the DENY,
 *   4. only then attach the verdict to that span and emit it.
 */
export async function handleGuardEvent(
  event: ToolEvent,
  config: PintaConfig,
): Promise<number> {
  // Blocking the agent's own subagent-control tools does not stop a risky
  // action — it breaks the control loop and kills the turn. Exempt, but still
  // record so the activity remains visible.
  if (isInternalTool(event.tool_name)) {
    await emitBestEffort(event, config);
    return 0;
  }

  // The span is built BEFORE the guard is asked, and the guard is asked about
  // that span. Since core 0.8.0 it is the one reading of the event, judged by
  // the manager through the same AgentEvent assembly the backend stores it
  // with. Until then the guard got a hand-picked summary beside the span, and
  // the summary drifted — `cwd` (PTA-176) and the hook name (PTA-207) were on
  // the span and not in the summary.
  const payload = buildEventPayload(event, config);
  const guard = await evaluateGuard(payload, process.env.PINTA_GUARD_ENDPOINT);

  let exitCode = 0;

  // SECURITY: the decision is written BEFORE telemetry so a later telemetry
  // failure can never bubble to runHook's fail-open catch and silently allow a
  // tool the guard blocked.
  if (guard?.decision === "DENY" && isEnforcing()) {
    // Prefer the manager-supplied userMessage (it carries the branded text plus
    // the rule that fired); fall back to the raw rule name, then to a literal.
    const reason = guard.userMessage ?? guard.reason ?? "guard_deny";
    exitCode = writeDeny(event.hook_event_name, reason).exitCode;
  }

  // The verdict rides on the span the guard judged — same spanId.
  attachGuard(payload, guard);
  await sendBestEffort(payload, config);
  return exitCode;
}
