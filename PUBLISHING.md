# Publishing `@pinta-ai/pinta-musecode`

This package is published to **npmjs (public)**. It depends on the **private**
`@pinta-ai/core` (GitHub Packages), which is **bundled and minified into `dist/`
at build time via esbuild** — so npm consumers never need access to the private
registry.

- Build target: node18. `dist/` is self-contained with **no runtime
  `@pinta-ai/core` dependency**; it is a `devDependency`, inlined at build.
- The committed `.npmrc` has **no `@pinta-ai` scope redirect**, so this adaptor's
  own `@pinta-ai/*` name still resolves to npmjs for publish/view.
  `@pinta-ai/core` is fetched from GitHub Packages via the URL pinned in
  `package-lock.json`.
- Publishing uses **npm OIDC trusted publishing** (`permissions.id-token: write`
  plus `setup-node`'s `registry-url`), not an `NPM_TOKEN` secret. Do not add an
  `_authToken` line for npmjs to `.npmrc`: when the secret is absent it expands
  to an empty string and `npm publish` fails `ENEEDAUTH` instead of falling
  through to OIDC.

## Why the package must be public

`pinta-manager` installs adaptors from **unauthenticated
`registry.npmjs.org` tarball URLs** listed in the public `pinta-catalog` index
and checks them against a pinned sha256. A restricted package would simply be
uninstallable, so `npm publish --access public` is load-bearing.

The repository is public too, matching `pinta-cc`, `pinta-codex`,
`pinta-copilot`, `pinta-gemini` and `pinta-opencode`. Worth knowing when reading
`README.md`: unlike those hosts, Muse Code publishes no hook API — `muse --help`
does not mention hooks at all — so every contract documented there was recovered
by running the binary and observing it, not from vendor documentation. Treat it
as an observation of `0.1.0-R708.1` that can change without notice, not as a
supported interface.

## One-time setup

1. **Grant this repository read access to the `@pinta-ai/core` package.**
   GitHub Packages → `core` → *Package settings* → *Manage Actions access* →
   add `pinta-ai/pinta-musecode` with the **Read** role.

   > ✅ **Done.** Until this grant existed every workflow failed at `npm ci` with
   > `403 … Permission permission_denied: read_package` on the GitHub Packages
   > URL (pinta-musecode#1). Nothing in the repo had to change — the first run
   > after the grant went green and committed `dist/` for the first time.
   >
   > Worth recording for the next adaptor: making the repository public does
   > **not** substitute for the grant; that was tried and the 403 was unchanged.
   > Package access is granted per package, independently of repository
   > visibility.

2. Nothing else. `GITHUB_TOKEN` (automatic in Actions) authenticates the
   GitHub Packages fetch; OIDC authenticates the npmjs publish.

## The lockfile

`npm ci` requires `package-lock.json`, and generating one requires a token with
`read:packages`. The current lockfile was derived from `pinta-copilot`'s, whose
`devDependencies` are identical to this adaptor's — same six entries, same
ranges, no runtime dependencies on either side — with the root `name`, `version`
and `license` swapped.

To regenerate it properly once you have a PAT with `read:packages`:

```sh
export NODE_AUTH_TOKEN=<github PAT with read:packages>
npm install @pinta-ai/core@^0.5.0 --save-dev --registry=https://npm.pkg.github.com
git add package.json package-lock.json
git commit -m "chore: lock @pinta-ai/core from GitHub Packages"
```

## Local development

`npm install` needs GitHub Packages auth for `@pinta-ai/core`. Either set
`NODE_AUTH_TOKEN` to a PAT with `read:packages` and install that one package with
`--registry=https://npm.pkg.github.com`, or `npm link @pinta-ai/core` against a
local `../pinta-core` checkout.

## Release

1. Bump the version in `package.json`; commit.
2. Push a `v<version>` tag.
3. The `publish` workflow runs `npm ci` → `npm run build` (esbuild bundles core
   into `dist/`) → `npm publish --access public`. It verifies the tag matches the
   version, skips if that version is already on npmjs, and posts to Slack.

## Registering in the catalog

Publishing to npmjs is not enough — the manager only installs what the public
`pinta-catalog` index lists, so an unregistered adaptor is invisible no matter
how green this repo is. The catalog pins the tarball by hash, so this step
cannot be prepared in advance: **the sha256 does not exist until the package is
published.**

In `pinta-ai/pinta-catalog`, after the publish workflow succeeds:

```sh
V=0.1.0
curl -sL "https://registry.npmjs.org/@pinta-ai/pinta-musecode/-/pinta-musecode-$V.tgz" \
  | shasum -a 256
```

Write `catalog/pinta-musecode/$V.yaml` using `catalog/pinta-copilot/0.3.1.yaml`
as the closest model, with the hash above and:

```yaml
ingest:
  via: manager
  type: musecode
targets:
  - client: musecode
    install:
      type: musecode
      dist_root: package/dist
      hooks_template: package/hooks/managed-hooks.template.json
      env_file_keys:
        OTEL_EXPORTER_OTLP_ENDPOINT: relay-endpoint
        OTEL_EXPORTER_OTLP_HEADERS: relay-token
```

Two differences from every other adaptor, both deliberate:

- **`hooks_template` is required here**, where `pinta-copilot` omits it and
  builds its hooks file in code. Muse Code silently skips any event whose group
  or handler carries a key it does not recognise — no error, no log, no non-zero
  exit — so a drift between a hand-built file and the adaptor's own event list
  would produce a half-enrolled client that looks fine. Shipping the template as
  the single source of truth removes the possibility.
- **The env keys are not namespaced.** `pinta-copilot` prefixes with
  `COPILOT_PLUGIN_OPTION_*` to avoid colliding with Copilot's own native OTel
  export. Muse Code has no native OTel, and it filters a hook's environment down
  to 13 variables anyway, so the standard `OTEL_EXPORTER_OTLP_*` names are read
  from the adaptor's own env file rather than inherited.

Then regenerate and verify the index:

```sh
bun run catalog:build
bun run catalog:check --verify-artifacts
```

`catalog:build` recomputes each manifest's own sha256 into `catalog/index.json`;
`--verify-artifacts` re-downloads the npm tarball and checks it against the hash
in the manifest, which is the check that catches a copy-paste error here.

Do **not** give the manifest a `minimumRequiredManagerVersion` floor in
`catalog.config.json`, even though `musecode` is a client kind older managers do
not know. With `oldestSupportedFloorBlind: null` only floor-free versions are
eligible to be an adaptor's `latest`, so a floor would make 0.1.0 permanently
uninstallable. It is also unnecessary: enrollment is driven by detected clients,
an older manager has no `musecode` entry in its detection specs, so it never
detects a Muse Code install and never resolves this adaptor at all.
