# Checks and releases

Pull requests and pushes to main run the tests and UI build on Linux, Windows x64, Apple Silicon, and Intel Mac with Node.js 22. Older runs on the same branch are cancelled. Dependencies are cached; normal checks do not upload artifacts. Documentation changes also run the check so a required status is always reported.

Dependabot opens grouped patch/minor updates weekly, separating routine dependencies from runtime/security-sensitive dependencies. Major updates stay separate; GitHub Actions groups contain only patch/minor updates. Follow the dependency review below before every release. Merges are performed as part of the release review, not by an unattended auto-merge bot.

## Prepare a release

1. Review and clear eligible Dependabot PRs using the procedure below, then use `npm version patch --no-git-tag-version` (or minor/major) to update package.json and package-lock.json. Add the matching version entry to CHANGELOG.md.
2. Merge the version and application changes into main after checks pass.
3. Open Actions → Release → Run workflow, select main, and leave **Create a draft release** off for a build-only validation, or enable it to prepare a release. Enable **Sign and notarize Mac apps** for Developer ID releases after configuring the signing environment below.
4. The workflow tests and builds on Apple Silicon, Intel Mac, and Windows x64, starts each packaged runtime to test IPC, verifies bundle contents and versions, checks Mac signatures before and after ZIP extraction, and prepares three ZIPs, combined SHA-256 checksums, and changelog-based notes. Build artifacts expire after one day.
5. Download each app and check installation, startup, OAuth, and AI client registration on its target OS. For a draft release, review its notes and assets, then publish it from Releases. Publication makes the version eligible for the app's update checker.

The workflow never overwrites an existing release. Choose a new version for subsequent releases. A failed build-only run creates no release or tag. Draft publication uses a separate job with write access; build jobs have read-only repository access. Only explicitly selected signed Mac builds receive signing credentials from the `mac-signing` environment.

Standard GitHub-hosted runners are used throughout. Release publication runs only when this workflow is manually started; there are no scheduled builds. Dependency, build, and workflow PRs also run credential-free packaging checks. Windows builds remain unsigned. The release workflow defaults to Developer ID signing. Local builds without signing settings, or workflow runs with signing disabled, use ad-hoc signing for credential-free validation. Developer ID mode signs with hardened runtime after all bundle resources are written, notarizes with Apple, and staples the ticket. Missing credentials or failed notarization stop that build; it never falls back to ad-hoc signing. Signing and strict recursive verification failures stop the build; release packaging also verifies the extracted ZIP. Ad-hoc verification checks bundle integrity, not Gatekeeper approval. Developer ID mode additionally verifies the expected signing identity, stapled ticket, and Gatekeeper acceptance after ZIP extraction. Test a browser-downloaded ZIP on a separate Mac before publication, including the Privacy & Security approval flow. Windows distributes a portable app folder rather than an installer.

## Local builds

Use `BUILD_ARCH=x64 npm run build:desktop` on Mac for Intel, or `BUILD_ARCH=arm64` for Apple Silicon.
On Windows PowerShell, set `$env:BUILD_PLATFORM="win32"` and `$env:BUILD_ARCH="x64"`, then run `npm run build:desktop`.
Keep the target environment set while running `node scripts/smoke-package.mjs` and `python scripts/package-release.py`.
The smoke test uses an isolated temporary state directory and port 43139. Its default startup limit is 30 seconds; set `SMOKE_TIMEOUT_MS=180000` for slow emulation or first-launch translation.
Keep the pinned optional build bindings for all release targets in package-lock.json so `npm ci` works on every host.
For offline builds, `ELECTRON_ZIP_DIR` may point to a directory containing the official Electron ZIP
for the exact pinned version and target. Verify that ZIP against Electron's published SHA-256 checksums first.

## Developer ID signing setup

Direct distribution requires an active Apple Developer Program membership and a
**Developer ID Application** certificate with its private key. An **Apple
Development** certificate is not sufficient. Create the certificate in Xcode's
account certificate manager or Apple's developer account, or import an existing
certificate and private key into Keychain Access. Do not revoke existing certificates.

For local builds, store notarization credentials interactively in Keychain:

```sh
xcrun notarytool store-credentials router-notary
```

Use your Apple ID, an app-specific password, and the certificate's Team ID when
prompted. Keep passwords and private keys out of shell history, chat, and the repo.
Then set these non-secret settings in the build shell (replace the synthetic identity):

```sh
export MAC_SIGNING_MODE=developer-id
export MAC_SIGNING_IDENTITY='Developer ID Application: Example Developer (A1B2C3D4E5)'
export MAC_NOTARY_PROFILE=router-notary
export BUILD_ARCH=arm64
npm run build:desktop
node scripts/smoke-package.mjs
python3 scripts/package-release.py
```

Repeat for `BUILD_ARCH=x64` on a compatible Mac. `MAC_SIGNING_KEYCHAIN` optionally
selects a keychain containing both the signing identity and notarization profile.
Local development builds with none of these settings remain ad-hoc signed.

For GitHub Actions, create the **mac-signing** environment, restrict it to `main`,
and add the credentials below. Required reviewers are optional; this repository
runs signed releases without a separate deployment approval. Keep the `main`
branch restriction in place. Add:

- Secrets: `MAC_CERTIFICATE_P12_BASE64` (base64 of an encrypted P12 export containing
  the certificate and private key), `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, and
  `APPLE_APP_PASSWORD` (an app-specific password).
- Variables: `MAC_SIGNING_IDENTITY` (full Developer ID Application certificate name)
  and `APPLE_TEAM_ID`.

Use GitHub's secret entry UI or secure stdin; never commit the P12, passwords, or
encoded certificate. The signed workflow imports into a temporary keychain,
stores the notarization profile there, and deletes it and the P12 even after a
failed build. The credential-free `build` environment needs no secrets. Both Mac
architectures must pass before a draft can be created. Do a build-only signed run
first, then test the browser-downloaded archives on a separate Mac before publishing.

## Mac automatic updates

Developer ID builds include a signed `mac-update.json` resource enabling Electron's
native updater. Ad-hoc builds keep manual downloads. After verifying the signed
ZIP, packaging writes `update-mac-arm64.json` or `update-mac-x64.json`, containing
the exact versioned GitHub ZIP URL, SHA-256, and byte size. Publish these JSON files
alongside the ZIPs; the draft workflow includes them automatically. Ad-hoc builds
never generate update feeds. Do not replace an existing version's assets.

The app discovers the latest stable public release, checks for the matching
architecture's feed, and gives its version-specific URL to Squirrel.Mac. Downloads
run in the background; Squirrel verifies signing identity and installs on quit or
**Restart to update**. The renderer cannot choose an update URL or install path.
A feed missing from the release keeps the manual-download path available.

Run the isolated signed updater integration check on macOS:

```sh
MAC_SIGNING_IDENTITY='Developer ID Application: Example Developer (A1B2C3D4E5)' node scripts/test-mac-update.mjs
```

It creates two fixture apps with a separate bundle ID and temporary data, rejects
a tampered update, then downloads, installs, and relaunches a correctly signed one.
Its loopback HTTP exception exists only in fixture bundles; production keeps ATS.
It never starts or replaces an installed router. Also test the
real browser-downloaded app from Applications. Older app versions need a manual
install of the first signed build containing updater support. Switching to a
different signing team requires migration testing and may require manual install.

Local signing works with automatic updates too: sign and notarize on a Mac, then
upload only the finished ZIPs, update feeds, and checksums to the draft release.
GitHub signing secrets are only needed for signing within Actions.

## Dependency review before each release

The agent preparing a requested release should inspect open Dependabot PRs before
bumping the app version. The release request includes authorization to merge
routine updates that pass this procedure; separate per-PR approval is unnecessary.
This review does not publish a release or authorize bypassing branch protections.

1. List open Dependabot PRs (`gh pr list --author app/dependabot`) and inspect the
   actual manifest/lockfile or workflow diff plus upstream release notes. Check
   changed transitive dependencies, install scripts, registry URLs, license changes,
   and platform constraints. Prioritize security fixes, but still verify them.
2. Classify by impact, not just version number:
   - Routine patch/minor changes with no sensitive behavior or migration requirements:
     review and merge after the checks below pass. A mixed group takes the highest
     risk of any member; split it or validate the entire group at that level.
   - Electron, packaging/signing tools, MCP/OAuth, schema validation, configuration
     parsing, or storage: inspect compatibility and run relevant integration checks.
     Electron/signing changes additionally need a signed local build and
     `scripts/test-mac-update.mjs`; keep credentials out of PR workflows.
   - Major versions, migration requirements, new permissions, or changes to release
     workflow actions: keep separate and assess their specific migration and release
     behavior. Green unit tests alone are not sufficient. Verify action commit pins
     against upstream and exercise affected packaging/artifact behavior without secrets.
3. Rebase/update onto current main, install the locked dependencies with `npm ci`,
   regenerate `THIRD_PARTY_NOTICES.md` with `python3 scripts/generate-notices.py`,
   and resolve missing license texts. Commit notice changes on the update branch
   or a replacement maintenance PR; do not modify generated output by hand.
4. Require `npm test`, `npm run build:ui`, and the required GitHub checks on the
   current PR head. Dependency/build/workflow changes also build and smoke-test
   packaged apps on Apple Silicon, Intel Mac, and Windows in CI, then verify the
   bundles. These PR jobs use ad-hoc Mac signing and no release credentials.
   For UI library changes, check the affected dialogs/menus with fictional data;
   refresh README screenshots only if the captured UI changes.
5. Merge eligible PRs sequentially through normal branch protections. Recheck the
   combined result on current main, especially overlapping lockfile updates. Never
   use an admin bypass to merge a stale or failing PR. Regenerate notices again
   if resolving conflicts changes the final dependency set.
6. Close duplicates/superseded PRs only after confirming every intended update is
   included in merged main. Leave intentional major upgrades open with a concrete
   reason for deferral; do not close them merely to make the list empty. Summarize
   merged updates and remaining work in the release handoff.

A failed or deferred dependency update should not force an unrelated release to
wait unless it is required for that release's correctness or security. Do not
silently ignore a relevant unresolved security advisory.
