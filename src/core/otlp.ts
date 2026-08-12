import os from "node:os";
import type { BaseEvent } from "./types.js";
import {
  attrsFromRecord,
  buildPayload,
  snakeCase,
  type AttrPolicy,
  type GuardResult,
  type OtlpAttribute,
  type OtlpPayload,
} from "@pinta-ai/core";

// The OTLP envelope and the redaction-aware attribute pipeline live in
// @pinta-ai/core. This module keeps only the muse-specific bits: event
// flattening, resource attributes, host version resolution, redaction policy.

/**
 * Reported as `telemetry.sdk.version` on every span and as the instrumentation
 * scope version. aware-backend persists it verbatim
 * (`ingest.parser.ts` → `telemetrySdkVersion`), so it is the only way to tell
 * from stored telemetry which adaptor version emitted a span.
 *
 * It is a literal, not a package.json import, because the bundle is built by
 * esbuild from a CLI invocation with no config file — importing JSON would
 * inline the whole manifest into dist. The literal is kept honest by
 * `tests/core/adapter-version.test.ts`, which fails the build when it drifts
 * from package.json. Do not downgrade that test to a comment: this constant
 * silently drifted on the very first version bump (0.1.1 shipped reporting
 * 0.1.0) precisely because a "keep in sync" comment was all that guarded it.
 */
export const ADAPTER_VERSION = "0.1.2";
export const INGEST_TYPE = "musecode";
const ATTR_PREFIX = "muse";

// os.userInfo() throws when the running uid has no passwd entry (containers with
// an arbitrary uid, CI, service accounts). resourceAttrs() runs on every span
// build, so an unguarded call means total telemetry loss there. Guard + memoize.
let cachedProcessOwner: string | undefined;
function processOwner(): string {
  if (cachedProcessOwner === undefined) {
    try {
      cachedProcessOwner = os.userInfo().username;
    } catch {
      cachedProcessOwner =
        process.env.USER ??
        process.env.LOGNAME ??
        (typeof process.getuid === "function" ? String(process.getuid()) : "unknown");
    }
  }
  return cachedProcessOwner;
}

/**
 * Muse Code ships as a single native binary, so there is no package.json to walk
 * the way pinta-cc resolves the Claude Code version. Spawning `muse --version`
 * per hook would add a process launch to every tool call, so we only read what
 * the host hands us: a version field on the payload, else an env var, else
 * "unknown". Never throws, never spawns.
 */
export function resolveHostVersion(event: BaseEvent): string {
  for (const key of ["muse_version", "version", "cli_version"]) {
    const v = event[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return process.env.MUSE_VERSION ?? "unknown";
}

/**
 * Attribute keys for which Tier-1 redaction is skipped (truncation still
 * applies). These are identifiers, enums, or our own resource attrs where a
 * false-positive mask would hurt more than help.
 */
const SKIP_REDACT_KEYS: ReadonlySet<string> = new Set([
  `${ATTR_PREFIX}.hook`,
  `${ATTR_PREFIX}.tool_name`,
  `${ATTR_PREFIX}.tool_use_id`,
  `${ATTR_PREFIX}.session_id`,
  `${ATTR_PREFIX}.cwd`,
  `${ATTR_PREFIX}.permission_mode`,
  `${ATTR_PREFIX}.agent_id`,
  `${ATTR_PREFIX}.agent_type`,
]);

// flattenEvent emits tool_input/tool_response as single JSON-stringified
// attributes (no nested flattening), so strict equality matches actual
// behaviour. If nested flattening is added, re-evaluate so bash context is not
// extended to unrelated nested keys.
const BASH_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  `${ATTR_PREFIX}.tool_input`,
  `${ATTR_PREFIX}.tool_response`,
]);

const ATTR_POLICY: AttrPolicy = {
  skipRedactKeys: SKIP_REDACT_KEYS,
  bashContextKeys: BASH_CONTEXT_KEYS,
};

export function flattenEvent(event: BaseEvent): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  // Discriminator first so aware-backend's detectIngestType hits it cheaply.
  out.push({ key: "ingest.type", value: { stringValue: INGEST_TYPE } });
  // Canonical hook key regardless of how the name was resolved (argv or payload).
  out.push({ key: `${ATTR_PREFIX}.hook`, value: { stringValue: event.hook_event_name } });
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (k === "hook_event_name") continue; // covered above
    rest[k] = v;
  }
  out.push(...attrsFromRecord(rest, ATTR_PREFIX, ATTR_POLICY));
  return out;
}

function resourceAttrs(event: BaseEvent): OtlpAttribute[] {
  return [
    { key: "service.name", value: { stringValue: "muse-code" } },
    { key: "service.version", value: { stringValue: resolveHostVersion(event) } },
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-musecode" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: ADAPTER_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: processOwner() } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } },
  ];
}

export function buildOtlpPayload(args: {
  event: BaseEvent;
  traceId: string; // ULID (26 chars)
  now?: number; // ms since epoch; injectable for tests
  guard?: GuardResult | null;
}): OtlpPayload {
  return buildPayload({
    traceId: args.traceId,
    spanName: `${ATTR_PREFIX}.${snakeCase(args.event.hook_event_name)}`,
    attributes: flattenEvent(args.event),
    resource: resourceAttrs(args.event),
    scope: { name: "pinta-musecode", version: ADAPTER_VERSION },
    now: args.now,
    guard: args.guard,
  });
}
