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

`pinta-manager` installs adaptors from **unauthenticated tarball URLs** listed in
the public `pinta-catalog` index and checks them against a pinned sha256. Two
independent places do that fetch, and **neither one ever sends an
`Authorization` header**:

| Fetcher | Code | Headers sent |
| --- | --- | --- |
| Manager install | `sidecar/src/catalog/retry.ts` → `fetch(url, { signal, headers: { 'User-Agent': MANAGER_UA } })` | `User-Agent` only |
| Catalog CI (`catalog:verify-artifacts`) | `scripts/catalog-build.mjs` → `fetch(url)` | none |

So a restricted package is not merely inconvenient, it fails twice: end users
get a 401 at install time, and the catalog PR cannot even go green. There is no
npm auth plumbing to add a token to — `npm publish --access public` is
load-bearing.

For the same reason **GitHub Packages is not an escape hatch**, even though
`@pinta-ai/core` and `@pinta-ai/mcp-logger` live there rather than on npmjs.
Those are consumed at *build* time, where a `NODE_AUTH_TOKEN` exists; `core` is
bundled into `dist/` by esbuild and never fetched at runtime. An adaptor tarball
is fetched at *install* time by an unauthenticated client, which is a different
situation entirely.

Neither the manifest schema (`z.string().url()`) nor the catalog scripts pin the
URL host, so a public non-npm host would technically resolve. Don't: the other
six adaptors all use `registry.npmjs.org`, and `type: npm-tarball` carries the
`package/` path prefix that the install paths assume.

The repository is public too, matching `pinta-cc`, `pinta-codex`,
`pinta-copilot`, `pinta-gemini` and `pinta-opencode`. Worth knowing when reading
`README.md`: unlike those hosts, Muse Code publishes no hook API — `muse --help`
does not mention hooks at all — so every contract documented there was recovered
by running the binary and observing it, not from vendor documentation. Treat it
as an observation of `0.1.0-R708.1` that can change without notice, not as a
supported interface.
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

`npm install`/`npm ci` needs GitHub Packages auth for `@pinta-ai/core`. The
project `.npmrc` reads it from `NODE_AUTH_TOKEN`; when that variable is unset it
expands to an empty string and the request goes out unauthenticated.

**Two registries are in play and getting rights on one does nothing for the
other.** Publishing `@pinta-ai/pinta-musecode` is an *npmjs* scope permission;
fetching `@pinta-ai/core` is a *GitHub Packages* one. The error URL tells you
which you are missing — if it contains `npm.pkg.github.com`, npmjs rights are
irrelevant to it.

Read the status code, it distinguishes the two failure modes exactly:

| Status | Meaning |
| --- | --- |
| `401 … unauthenticated: User cannot be authenticated with the token provided` | no token at all — `NODE_AUTH_TOKEN` is unset or empty |
| `403 … permission_denied: read_package` | token is valid but lacks `read:packages`, or has no access to the package |

The quickest fix, if you already use `gh` (this adds the scope to the existing
OAuth token — a classic PAT with `read:packages` works too):

```sh
gh auth refresh -h github.com -s read:packages
export NODE_AUTH_TOKEN=$(gh auth token)
npm ci
```

Alternatively `npm link @pinta-ai/core` against a local `../pinta-core`
checkout, which sidesteps the registry entirely.

### You do not need any of this just to publish

`dist/` is committed, and `build-dist.yml` rebuilds and commits it on every push
to `main`, so a checkout of `main` already contains the built artifact. The only
thing in the publish path that needs `node_modules` is the `prepublishOnly`
script, which just rebuilds what is already there:

```sh
npm login                                   # npmjs, separate from GitHub
npm publish --ignore-scripts --access public
```

`--ignore-scripts` skips `prepublishOnly` and publishes the committed `dist/`.
It produces a byte-identical tarball to a full `npm pack` — same shasum — since
`prepublishOnly` is the only lifecycle script in this package. Verify with
`npm publish --dry-run --ignore-scripts`, which needs neither login nor
`node_modules`.

Prefer this for the first publish: it removes the GitHub Packages dependency
from a step that is already blocked on a human, and it ships the CI-built
`dist/` rather than whatever a laptop happens to produce.

## Testing the published artifact without publishing

Publishing is irreversible-ish (a version number is burned even after
`npm unpublish`), and the first publish needs a human with scope rights. You do
not have to spend either to find out whether the artifact works: the whole
install path can run against a locally packed tarball, because nothing pins the
URL host.

```sh
npm pack --pack-destination /tmp/mc      # produces the exact tarball publish would upload
shasum -a 256 /tmp/mc/pinta-ai-pinta-musecode-*.tgz
cd /tmp/mc && python3 -m http.server 8791 --bind 127.0.0.1
```

Then point a manifest at `http://127.0.0.1:8791/<file>.tgz` with that sha256 and
call the manager's own `installAdaptor()` from `sidecar/src/catalog/install.ts`.
That exercises the real download → sha256 verify → extract → atomic rename
sequence, not a mock. Worth asserting while you are there: a deliberately wrong
sha256 is rejected with `sha256 mismatch:` and leaves no `<version>` directory
behind.

Two things this catches that a unit test does not: that `artifact.entrypoint`
and `hooks_template` resolve inside the tarball's `package/` prefix, and that
`npm pack` actually included them — `files` in `package.json` is easy to get
wrong and only bites at install time.

Note the entrypoint is a **hook executable, not a library**: loading it runs it
and exits the process. Spawn it (`node <entrypoint>`); with no hook event in the
environment it exits 0 with `could not resolve hook event name; skipping`.

`npm pack` is deterministic — packing the same tree twice gives a byte-identical
tarball — so this sha256 is stable, and the catalog manifest can be drafted
before the publish happens. It is only *authoritative* if you packed the same
`dist/` that CI builds, so still re-check against the published tarball before
merging the catalog PR.

`npm publish --dry-run` is the other option, but it is strictly weaker: it runs
`prepublishOnly` (a full build, so it needs `node_modules` and GitHub Packages
auth for `@pinta-ai/core`) and reports what *would* be uploaded, without ever
proving the artifact installs.

## Release

1. Bump the version in `package.json`; commit.
2. Push a `v<version>` tag.
3. The `publish` workflow runs `npm ci` → `npm run build` (esbuild bundles core
   into `dist/`) → `npm publish --access public`. It verifies the tag matches the
   version, skips if that version is already on npmjs, and posts to Slack.

### The first publish cannot use this workflow

`publish.yml` authenticates with OIDC trusted publishing and holds no npm
token — same as `pinta-copilot` and `pinta-opencode`. **That only works for a
package that already exists.** A trusted publisher is configured per package on
npmjs, and `@pinta-ai/pinta-musecode` is not published yet (`registry.npmjs.org`
returns 404), so there is nothing to attach the publisher to and the first
`v0.1.0` tag push would fail authentication. This is an npm limitation, not a
misconfiguration here — see [npm/cli#8544](https://github.com/npm/cli/issues/8544),
still open.

So `0.1.0` has to be published once by hand, by someone with publish rights on
the `@pinta-ai` scope:

```sh
git checkout main && git pull          # dist/ is committed and CI-built
npm login                              # npmjs — unrelated to GitHub Packages
npm publish --ignore-scripts --access public   # 2FA prompt
```

`--ignore-scripts` matters here: without it `prepublishOnly` runs a full rebuild,
which needs `node_modules` and therefore GitHub Packages auth for
`@pinta-ai/core`. That is a *second* permission, and whoever has npmjs scope
rights very likely does not have it — the publish then dies on `npm ci` with a
`401` from `npm.pkg.github.com`, which reads like the npmjs grant failed when it
did not. See *Local development* above. Skipping the script publishes the
committed `dist/` and yields a byte-identical tarball.

Then configure the trusted publisher on npmjs (package → *Settings* →
*Trusted publisher* → repository `pinta-ai/pinta-musecode`, workflow
`publish.yml`), and every later tag goes through the workflow untouched.

Verify before publishing that the tarball carries the two files the catalog
manifest points at — this has been checked for `0.1.0`:

```
$ npm pack --dry-run
… dist/index.js
… dist/index.mjs
… hooks/managed-hooks.template.json
```

An npm tarball roots its contents under `package/`, which is why the manifest
paths below read `package/dist/…` and `package/hooks/…`.

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

Use that command, not `npm view … dist.integrity` or `dist.shasum`: the catalog
validates `artifact.sha256` against `/^[a-f0-9]{64}$/`, and npm reports neither
form of it — `dist.integrity` is base64 SRI (`sha512-…`) and `dist.shasum` is
SHA-1.

Write the hash into `catalog/pinta-musecode/$V.yaml`. The whole file is below;
only the `sha256` line is unknown until the publish. This exact content has been
checked against both `bun run catalog:build` and the manager's own
`AdaptorManifestSchema`, so it should need no edits beyond the hash:

```yaml
schema_version: 1
id: pinta-musecode
name: Pinta Muse Code
version: 0.1.0
runtime: node
artifact:
  type: npm-tarball
  url: https://registry.npmjs.org/@pinta-ai/pinta-musecode/-/pinta-musecode-0.1.0.tgz
  sha256: "<the 64 hex chars from the command above>"
  entrypoint: package/dist/index.js
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
guard:
  evaluates: true
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
bun run catalog:verify-artifacts
```

`catalog:build` recomputes each manifest's own sha256 into `catalog/index.json`
— that second hash is generated, never hand-written, so the tarball hash above
is the only one anyone types. `catalog:verify-artifacts` re-downloads the npm
tarball and checks it against the manifest, which is the check that catches a
copy-paste error here.

Do **not** give the manifest a `minimumRequiredManagerVersion` floor in
`catalog.config.json`, even though `musecode` is a client kind older managers do
not know. With `oldestSupportedFloorBlind: null` only floor-free versions are
eligible to be an adaptor's `latest`, so a floor would make 0.1.0 permanently
uninstallable. It is also unnecessary: enrollment is driven by detected clients,
an older manager has no `musecode` entry in its detection specs, so it never
detects a Muse Code install and never resolves this adaptor at all.
