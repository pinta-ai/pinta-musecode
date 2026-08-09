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

   > ⚠️ **This is currently missing**, and it is the only thing standing between
   > the workflows and green. Without it `npm ci` fails with
   > `403 … Permission permission_denied: read_package` on the GitHub Packages
   > URL. Nothing in this repo needs to change once the grant exists — re-run the
   > failed job and it passes.

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
