/**
 * ESM dual-entry, built to dist/index.mjs via a separate `--format=esm` esbuild
 * step. Works as a direct-exec hook, but guarded so that *importing* this module
 * (the pinta-manager sidecar loading the adaptor) does not read stdin, dispatch
 * a hook, or exit the process.
 *
 * Guard: `import.meta.main` is Bun-only. Comparing `import.meta.url` to the
 * realpath of `process.argv[1]` works on Node and Bun alike.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Mirrors src/index.ts — env file first, before anything reads process.env.
import { loadEnvFile } from "./env-file.js";
loadEnvFile();

import { runHook } from "./hook.js";

function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    // argv[1] missing/unreadable (REPL, unusual host) — err towards NOT running
    // the hook, the safer default for an import()-based caller.
    return false;
  }
}

async function main(): Promise<void> {
  const exitCode = await runHook();
  process.exit(exitCode);
}

if (isDirectlyExecuted()) {
  void main();
}
