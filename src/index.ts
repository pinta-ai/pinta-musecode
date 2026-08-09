// Load ~/.config/muse/pinta-musecode.env BEFORE any other import that may read
// process.env. Muse Code clears the hook environment down to a small allowlist,
// so the env file is the only reliable config channel. See src/env-file.ts.
import { loadEnvFile } from "./env-file.js";
loadEnvFile();

// CJS hook entry (built to dist/index.js) — always direct-exec. Dispatch logic
// lives in ./hook.js, shared with the ESM entry so the two cannot drift.
import { runHook } from "./hook.js";

async function main(): Promise<void> {
  const exitCode = await runHook();
  process.exit(exitCode);
}

void main();
