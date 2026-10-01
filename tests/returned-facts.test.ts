import { describe, expect, it } from "vitest";
import { buildOtlpPayload } from "../src/core/otlp.js";

describe("native returned-content findings", () => {
  it.each(["ordinary", "FAKE0NativeOutputCredential123456"])("does not borrow completed input findings: %s", (output) => {
    const secret = "FAKE0NativeOutputCredential123456";
    const payload = buildOtlpPayload({
      traceId: "01HQXM7Y9YZJ8MK7Z6P3X1V8R0",
      event: {
        hook_event_name: "PostToolUse", session_id: "synthetic-facts", cwd: "/synthetic",
        tool_name: "Bash", tool_input: { command: "echo ordinary", header: `Authorization: Bearer ${secret}` },
        tool_response: output,
      },
    });
    const value = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.find((a) => a.key === "pinta.facts")?.value;
    if (!value || !("stringValue" in value)) throw new Error("Missing producer findings");
    expect(JSON.parse(value.stringValue).items[0].secrets.origins).toEqual([output === secret ? "toolOutput" : "attributes"]);
    expect(JSON.stringify(payload)).not.toContain(secret);
  });
});
