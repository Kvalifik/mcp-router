# Agent instructions

## Scope and validation

- Read [CONTRIBUTING.md](CONTRIBUTING.md). Keep changes focused and preserve
  unrelated working-tree changes; do not reset or overwrite someone else's work.
- Edit source files and regenerate build outputs with the documented commands;
  do not patch generated files directly.
- Run tests relevant to the change, and `npm run build:ui` for UI changes.
  Before submitting a pull request, run both `npm test` and `npm run build:ui`
  as required by the contribution guide. Report checks that could not run.
- Update [the usage guide](docs/USAGE.md), README, or
  [security policy](SECURITY.md) when changing the behavior they describe.
  Follow [the release guide](docs/RELEASING.md) for release work.

## Security and public files

- Preserve the controls described in [SECURITY.md](SECURITY.md): local owner
  authentication, loopback binding, Host/Origin and CSRF checks, Electron
  isolation and sandboxing, and project ownership and permission checks.
- Keep Stable and Beta OAuth grants separate. Do not bypass authorization or
  silently fall back to a different grant to make an operation succeed.
- Use synthetic fixtures. Never commit runtime state, OAuth tokens, encryption
  keys, client configurations or backups, private logs, or real customer data.
  Do not expose these in command output, screenshots, or public reports either.
- This file is public documentation. Keep internal company and client context
  out of it and other tracked files.
- New files are ignored by default. Review each public file and add an exact
  path to the `.gitignore` publication allowlist; do not broadly unignore
  directories or force-add private material.

## README screenshots

When changing visible UI represented in the README (branding, connection and
project rows, access badges, or the permissions dialog), regenerate the affected
screenshots as part of the change. Code-only changes that do not affect the
captured UI do not need new screenshots.

- Read [the screenshot guide](docs/images/README.md) and use
  `npx electron scripts/capture-readme.mjs` on macOS after dependencies are installed.
  This captures the current UI using an isolated demo profile and fictional data.
- Never capture real client names, project slugs, accounts, credentials, or saved
  router state. Keep demo data in the capture script; do not anonymize screenshots
  of real accounts or add demo behavior to the production app.
- Preserve both the project overview and permissions dialog. Keep representative
  pinned projects, enabled and disabled states, access presets, and authorized
  Beta labels on some projects.
- Preserve the compact macOS window, native controls, transparent window shadow,
  and 720px README display width unless the user requests a different presentation.
- Open and visually inspect both generated PNGs. Check that each shows its
  intended view, text is legible, controls fit, Beta labels appear in the overview,
  and neither image is blank, stale, or a duplicate of the other.
- Include updated images with the UI change. If the capture workflow needs to
  change, update the script and screenshot guide together. Explicitly allowlist
  any new public screenshot files in `.gitignore`.
- If macOS capture or Screen Recording permission is unavailable, report that
  screenshots still need regeneration and visual review. Do not claim they were
  refreshed or replace them with fabricated UI images.

Use the two existing screenshots by default. Add further views only when they
demonstrate a distinct feature and the user requests or agrees to the addition.
