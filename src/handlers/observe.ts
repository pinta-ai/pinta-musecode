import type { PintaConfig } from "../core/config.js";
import type { BaseEvent } from "../core/types.js";
import { emitBestEffort } from "./shared.js";

/** Every purely observational event: session, stop, subagent, compact, post-tool. */
export async function handleObserve(event: BaseEvent, config: PintaConfig): Promise<number> {
  await emitBestEffort(event, config);
  return 0;
}

/** UserPromptSubmit opens a new per-turn trace. */
export async function handleUserPrompt(event: BaseEvent, config: PintaConfig): Promise<number> {
  await emitBestEffort(event, config, { traceMode: "new" });
  return 0;
}

/**
 * Catch-all for events we deliberately skip (the opt-in per-LLM-call pair) and
 * any future event Muse Code adds that we have not routed yet. Exits 0 silently.
 */
export async function handleDefault(_event: BaseEvent): Promise<number> {
  return 0;
}
