// Muse-specific binding over the shared guard in @pinta-ai/core. Matches the
// other short-lived hook adapters: 10s timeout, relay token and disable flag
// read from process.env, and a `pinta-musecode/<version>` User-Agent that the
// manager's /guard/evaluate route parses to attribute calls per adapter.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
import type { GuardInput, GuardResult } from "@pinta-ai/core";
import { ADAPTER_VERSION } from "./version.js";

export type { GuardInput, GuardResult } from "@pinta-ai/core";

const TIMEOUT_MS = 10_000;
// Derived, not copied: this was a second hand-synced literal and it was still
// reporting 0.1.0 at 0.1.2, so the manager was attributing every guard call to
// the wrong adaptor version.
const GUARD_UA = `pinta-musecode/${ADAPTER_VERSION}`;

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
