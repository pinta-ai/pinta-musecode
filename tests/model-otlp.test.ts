import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { OtlpPayload } from "@pinta-ai/core";
import { MUSE_EVENTS } from "../src/core/types.js";

const scratch = `.model-wire-${randomUUID()}`;
const root = path.resolve(scratch);
const received: OtlpPayload[] = [];
const guarded: OtlpPayload[] = [];
let server: Server;
let endpoint: string;

function span(payload: OtlpPayload) {
  return payload.resourceSpans[0].scopeSpans[0].spans[0];
}
function attrs(payload: OtlpPayload): Record<string, unknown> {
  return Object.fromEntries(span(payload).attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
}

beforeAll(async () => {
  mkdirSync(scratch);
  await Promise.all([
    build({
      entryPoints: ["src/index.ts"], outfile: `${scratch}/hook.cjs`, bundle: true,
      platform: "node", format: "cjs", target: "node18", minify: true,
    }),
    build({
      entryPoints: ["src/index.mts"], outfile: `${scratch}/hook.mjs`, bundle: true,
      platform: "node", format: "esm", target: "node18", minify: true,
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ]);
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.parse(raw) as OtlpPayload;
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    if (req.url === "/guard") {
      guarded.push(payload);
      res.end(JSON.stringify({ decision: raw.includes("DENYME") ? "DENY" : "ALLOW", reason: "test-deny" }));
    } else {
      received.push(payload);
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});
beforeEach(() => { received.length = 0; guarded.length = 0; });

function fire(event: string, payload: Record<string, unknown>, opts: { llm?: boolean; enforce?: boolean; esm?: boolean } = {}) {
  return new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [`${root}/hook.${opts.esm ? "mjs" : "cjs"}`, event], {
      env: {
        PATH: "", HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, TMPDIR: root,
        PINTA_MUSECODE_DATA: `${root}/data`, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
        PINTA_GUARD_ENDPOINT: `${endpoint}/guard`, PINTA_MUSE_LLM_EVENTS: opts.llm ? "1" : "0",
        PINTA_MUSE_ENFORCE: opts.enforce ? "1" : "0", PINTA_MUSE_DENY_FORMAT: "auto",
      },
      stdio: ["pipe", "pipe", "pipe"], timeout: 10_000,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("built Muse hooks → loopback OTLP", () => {
  it("retains event-local reported models on all twelve recorded event envelopes", async () => {
    for (const event of MUSE_EVENTS) {
      const result = await fire(event, {
        hook_event_name: event, session_id: "s", turn_id: "turn", model: "muse-model-v1",
        provider: "meta", request_id: "request", transcript_path: null, permission_mode: "default",
        tool_name: "bash", tool_input: { command: "mysql -psecretpw" },
      }, { llm: true });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
    }
    expect(received).toHaveLength(MUSE_EVENTS.length);
    for (const payload of received) {
      expect(attrs(payload)).toMatchObject({
        "muse.model": "muse-model-v1", "muse.model_source": "reported:model",
        "muse.provider": "meta", "muse.session_id": "s", "muse.turn_id": "turn",
      });
      expect(attrs(payload)["muse.tool_input"]).not.toContain("secretpw");
    }
    expect(guarded).toHaveLength(2);
    const before = received.find((p) => attrs(p)["muse.hook"] === "PreToolUse")!;
    expect(span(guarded[0]).spanId).toBe(span(before).spanId);
    expect(attrs(guarded[0])["muse.model"]).toBe("muse-model-v1");
    await fire("PreLLMCall", { session_id: "s", model: "muse-model-v1" });
    await fire("PostLLMCall", { session_id: "s", model: "muse-model-v1" });
    expect(received).toHaveLength(MUSE_EVENTS.length); // existing opt-in/counts are unchanged
  }, 30_000);

  it("omits absent/placeholder models without borrowing from switched or concurrent agents", async () => {
    const inputs = [
      { session_id: "a", model: "lead-v1", marker: "lead" },
      { session_id: "a", subagent_id: "child", model: "child-v1", marker: "child" },
      { session_id: "b", model: "other-v1", marker: "other" },
    ];
    await Promise.all(inputs.map((input) => fire("PostToolUse", input)));
    await fire("PostToolUse", { session_id: "a", model: "lead-v2", marker: "switch" });
    writeFileSync(`${scratch}/malformed.jsonl`, "{broken");
    for (const model of [undefined, "unknown", " ", { id: "unsupported-shape" }, "{}", "[]", " \t{truncated", "\n [truncated"]) {
      await fire("Stop", { session_id: "a", model, transcript_path: `${root}/malformed.jsonl`, marker: "missing" });
    }
    expect(received).toHaveLength(12);
    for (const input of [...inputs, { marker: "switch", model: "lead-v2" }]) {
      expect(attrs(received.find((p) => attrs(p)["muse.marker"] === input.marker)!)["muse.model"]).toBe(input.model);
    }
    for (const payload of received.filter((p) => attrs(p)["muse.marker"] === "missing")) {
      expect(attrs(payload)["muse.model"]).toBeUndefined();
    }
  }, 30_000);

  it("keeps ESM enforcement, guard-span identity and internal-tool exemption unchanged", async () => {
    const denied = await fire("PreToolUse", {
      session_id: "s", model: "muse-model-v1", tool_name: "bash", tool_input: { command: "DENYME" },
    }, { esm: true, enforce: true });
    expect(denied.code).toBe(2);
    expect(JSON.parse(denied.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "test-deny" },
    });
    expect(attrs(received[0])["pinta.guard.decision"]).toBe("deny");
    expect(span(guarded[0]).spanId).toBe(span(received[0]).spanId);
    await fire("PreToolUse", {
      session_id: "s", model: "lead", tool_name: "subagent_spawn", tool_input: { model: "child", command: "DENYME" },
    }, { enforce: true });
    expect(guarded).toHaveLength(1);
    expect(received).toHaveLength(2);
    expect(attrs(received[1])["muse.model"]).toBe("lead");
  });
});
