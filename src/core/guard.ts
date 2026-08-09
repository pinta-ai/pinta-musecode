// Muse-specific binding over the shared guard in @pinta-ai/core. Matches the
// other short-lived hook adapters: 10s timeout, relay token and disable flag
// read from process.env, and a `pinta-musecode/<version>` User-Agent that the
// manager's /guard/evaluate route parses to attribute calls per adapter.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
import type { GuardInput, GuardResult } from "@pinta-ai/core";

export type { GuardInput, GuardResult } from "@pinta-ai/core";

const TIMEOUT_MS = 10_000;
// Keep in sync with package.json. The manager parses `pinta-musecode/<version>`.
const GUARD_UA = "pinta-musecode/0.1.0";

export function evaluateGuard(
  input: GuardInput,
  endpoint: string | undefined,
): Promise<GuardResult | null> {
  return coreEvaluateGuard(input, endpoint, {
    timeoutMs: TIMEOUT_MS,
    token: process.env.PINTA_RELAY_TOKEN ?? "",
    disabled: process.env.PINTA_GUARD_DISABLED === "1",
    userAgent: GUARD_UA,
  });
}
