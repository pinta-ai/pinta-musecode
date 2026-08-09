/**
 * Muse Code config directory resolution + graceful env-file loading.
 *
 * Muse Code follows XDG: its user config lives at `$XDG_CONFIG_HOME/muse`,
 * falling back to `~/.config/muse`.
 *
 * We cannot reuse @pinta-ai/core's `envFilePath(dir, file, overrideEnvVar)`
 * directly: its override treats the env var as the FULL base directory, whereas
 * `XDG_CONFIG_HOME` is the parent of `muse/`. So the directory is resolved here
 * and only the parser/merge semantics are borrowed from core.
 *
 * The env file matters more here than on any other host. Verified against
 * muse 0.1.0-R708.1: hook commands are handed an environment filtered down to
 * thirteen variables —
 *
 *   HOME LANG LOGNAME OLDPWD PATH PWD SHELL SHLVL TERM TMPDIR USER _
 *   __CF_USER_TEXT_ENCODING
 *
 * — so NO `PINTA_*` or `OTEL_*` variable exported by the user's shell ever
 * reaches this process.
 *
 * The obvious escape hatch does not exist. The managed hooks file appears to
 * accept a per-handler `env` block — the key is right there in the binary's
 * strings — but it does not work: a handler carrying `env` is skipped entirely,
 * and so is one carrying any other unrecognised key, with no error, no exit code
 * and no log line. Measured against a control that fired on the same run. So the
 * env file is not the tidier of two options; it is the ONLY configuration
 * channel that exists, which is why both entry points load it before anything
 * reads process.env.
 *
 * That allowlist has a second consequence: `XDG_CONFIG_HOME` is itself stripped,
 * so inside a hook this function can only ever resolve `$HOME/.config/muse`.
 * The XDG branch below still earns its place — `tools/doctor.ts` and the
 * pinta-manager sidecar run with a normal environment — but pinta-manager MUST
 * write the env file under `$HOME/.config/muse/` even for a user who has set
 * XDG_CONFIG_HOME, or the hook will silently find no configuration and every
 * event will no-op. `HOME` does survive, so that path always resolves.
 */
import os from "node:os";
import path from "node:path";
import { loadEnvFile as coreLoadEnvFile, parseEnvFile } from "@pinta-ai/core";

export { parseEnvFile };

export const ENV_FILE_NAME = "pinta-musecode.env";

/**
 * The environment Muse Code leaves a hook command with. Anything not on this
 * list must come from the env file.
 */
export const MUSE_HOOK_ENV_ALLOWLIST: readonly string[] = [
  "HOME",
  "LANG",
  "LOGNAME",
  "OLDPWD",
  "PATH",
  "PWD",
  "SHELL",
  "SHLVL",
  "TERM",
  "TMPDIR",
  "USER",
  "_",
  "__CF_USER_TEXT_ENCODING",
];

/**
 * `$XDG_CONFIG_HOME/muse`, else `~/.config/muse`.
 *
 * Inside a hook the XDG branch is unreachable (see the module comment); it is
 * kept for the manager and doctor paths, which do see a full environment.
 */
export function museConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return path.join(xdg, "muse");
  return path.join(os.homedir(), ".config", "muse");
}

/** The location pinta-manager must write to: always HOME-based, never XDG. */
export function hookVisibleEnvFilePath(): string {
  return path.join(os.homedir(), ".config", "muse", ENV_FILE_NAME);
}

export function envFilePath(): string {
  return path.join(museConfigDir(), ENV_FILE_NAME);
}

/** Fills only unset keys; silent no-op when the file is absent. */
export function loadEnvFile(filePath: string = envFilePath()): void {
  coreLoadEnvFile(filePath);
}
