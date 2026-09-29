import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateGuard, type GuardPayload } from "../../src/core/guard.js";
import { ADAPTER_VERSION } from "../../src/core/version.js";

const endpoint = "http://127.0.0.1:5147/guard/evaluate";
const payload = { resourceSpans: [] } as unknown as GuardPayload;

function allow(): Response {
  return new Response(JSON.stringify({ decision: "ALLOW", reason: null, durationMs: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The manager answers inside 80% of however long the caller will wait, and it
 * learns that number from `x-pinta-guard-budget-ms` (manager 0.1.10+). Without
 * the header it falls back to a table of adaptor timeouts copied into its own
 * repo — correct for this adaptor today, and stale the day the constant here
 * changes (PTA-579). `@pinta-ai/core` 0.9.0 sends the header from `timeoutMs`,
 * so this pins that the value on the wire is this adaptor's 10s.
 */
describe("evaluateGuard", () => {
  it("declares its 10s timeout to the manager as the caller budget", async () => {
    const fetchMock = vi.fn(async () => allow());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PINTA_GUARD_DISABLED", "");

    const result = await evaluateGuard(payload, endpoint);

    expect(result?.decision).toBe("ALLOW");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-pinta-guard-budget-ms": "10000",
      "user-agent": `pinta-musecode/${ADAPTER_VERSION}`,
    });
  });
});
