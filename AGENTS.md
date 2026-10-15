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

## UI icons

- When neighboring menu items have icons, every comparable item must have an
  icon too, including settings toggles. Do not introduce an iconless item into
  an otherwise icon-bearing group.
- Proactively suggest suitable icons when adding or changing UI actions and
  settings. Choose a clear semantic match from the existing Lucide icon set
  and briefly explain the choice; routine choices do not need approval.
- Keep icon size and placement consistent. Verify that chosen menu icons are
  supported in both the browser menu and Electron native menu registries.

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

## Dependency review before releases

Lead release scope reviews with a concrete recommendation, not a list of decisions
for the user to solve. Explain the benefit, risk, validation and proposed grouping.
For requested upstream parity, routine compatible additions and schema fixes are
in scope: implement them after reviewing permissions and ownership. Ask only when
a candidate materially expands the authorized scope, introduces a significant
tradeoff, or requires unavailable access. Group related choices into one recommended
plan and honor existing authorization; do not ask repeatedly about its execution.
Never silently omit a candidate: report what was included, explicitly deferred,
excluded by design, or could not be verified, with reasons and a recommended next step.
An unavailable channel is an incomplete review, not evidence of compatibility.

Before every release, also perform the Webflow MCP compatibility review in
`docs/RELEASING.md` for Stable and Beta separately. New operations may reuse
existing permissions only after reviewing effects, project scope and ownership
checks. New permission categories require explicit review. Never grant unseen
upstream tools access automatically. Document deferred changes and unavailable
channel checks; do not claim parity from an incomplete snapshot.

Before preparing a release, review open Dependabot PRs using the dependency
review procedure in `docs/RELEASING.md`. Once the user includes a candidate in scope,
routine patch/minor updates may be merged after diff review, refreshed license notices,
and all required checks pass; do not ask for a separate routine merge approval.
Do not treat semver or a green test suite alone as evidence that an update is low
risk. Keep major upgrades and runtime/security-sensitive changes separate, run
the additional checks described in the guide, and report any deferrals with a
specific reason. Close superseded PRs only after verifying the replacement is
merged. Never bypass branch protections or expose signing secrets to PR jobs.
