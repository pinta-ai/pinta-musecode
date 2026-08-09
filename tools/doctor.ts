/**
 * Environment doctor.
 *
 * Run before enrolling a machine: `npx tsx tools/doctor.ts`
 *
 * The check that actually matters is Node on Linux. Muse Code installs as a
 * single native binary (`curl -fsSL https://dev.meta.ai/install.sh | sh`) and
 * runs on macOS and Linux only, so its users have no reason to have Node at all.
 * pinta-manager bundles a Node binary for macOS and Windows but NOT for Linux,
 * where it invokes the literal `node` token. Those two facts collide exactly on
 * Linux: enrollment succeeds and the hooks then silently never run — the worst
 * possible failure for a security tool.
 *
 * So on Linux this exits non-zero when Node is missing. Enrollment must fail
 * loudly rather than leave a machine that looks protected and is not.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { envFilePath, museConfigDir } from "../src/env-file.js";
import { pluginDataDir } from "../src/core/config.js";

type Level = "ok" | "warn" | "fail";

const results: { level: Level; label: string; detail: string }[] = [];

function record(level: Level, label: string, detail: string): void {
  results.push({ level, label, detail });
}

function checkNode(): void {
  const platform = os.platform();
  let version: string | null = null;
  try {
    version = execFileSync("node", ["--version"], { encoding: "utf-8" }).trim();
  } catch {
    version = null;
  }

  if (version) {
    record("ok", "node", `${version} (${platform})`);
    return;
  }
  if (platform === "linux") {
    record(
      "fail",
      "node",
      "not found. pinta-manager ships no bundled Node for Linux, so the hook " +
        "command would never run. Install Node >= 18 before enrolling.",
    );
    return;
  }
  record("warn", "node", `not on PATH, but pinta-manager bundles Node on ${platform}.`);
}

function checkMuse(): void {
  try {
    const v = execFileSync("muse", ["--version"], { encoding: "utf-8" }).trim();
    record("ok", "muse", v);
  } catch {
    record("warn", "muse", "not on PATH — cannot verify the host or run hook fixtures.");
  }
}

function checkPlatform(): void {
  const platform = os.platform();
  if (platform === "darwin" || platform === "linux") {
    record("ok", "platform", platform);
  } else {
    record("fail", "platform", `${platform} — Muse Code supports macOS and Linux only.`);
  }
}

function checkConfig(): void {
  const dir = museConfigDir();
  record(fs.existsSync(dir) ? "ok" : "warn", "muse config dir", dir);

  const env = envFilePath();
  if (!fs.existsSync(env)) {
    record("warn", "env file", `${env} (absent — the manager writes this at enroll)`);
    return;
  }
  // Never print values: this file holds the relay token.
  const keys = fs
    .readFileSync(env, "utf-8")
    .split("\n")
    .map((l) => l.split("=")[0].trim())
    .filter((k) => k.length > 0 && !k.startsWith("#"));
  record("ok", "env file", `${env} (${keys.length} keys: ${keys.join(", ")})`);
}

function checkEndpoints(): void {
  const otlp =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  record(otlp ? "ok" : "warn", "otlp endpoint", otlp ?? "unset — telemetry silently disabled");

  const guard = process.env.PINTA_GUARD_ENDPOINT;
  record(guard ? "ok" : "warn", "guard endpoint", guard ?? "unset — guard silently disabled");

  const enforcing = process.env.PINTA_MUSE_ENFORCE === "1";
  record(
    "ok",
    "mode",
    enforcing ? "ENFORCING — a DENY is written back to the host" : "shadow (default) — never blocks",
  );
}

function checkStateDir(): void {
  const dir = pluginDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    record("ok", "state dir", dir);
  } catch (err) {
    record("fail", "state dir", `${dir} is not writable: ${err}`);
  }
}

checkPlatform();
checkNode();
checkMuse();
checkConfig();
checkEndpoints();
checkStateDir();

for (const r of results) {
  const icon = r.level === "ok" ? "  ok  " : r.level === "warn" ? " warn " : " FAIL ";
  process.stdout.write(`[${icon}] ${r.label.padEnd(16)} ${r.detail}\n`);
}

const failed = results.filter((r) => r.level === "fail");
if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} blocking problem(s). Do not enroll this machine.\n`);
  process.exit(1);
}
process.stdout.write("\nNo blocking problems.\n");
