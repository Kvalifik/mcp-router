# Checks and releases

Pull requests and pushes to main run the tests and UI build on Linux, Windows x64, Apple Silicon, and Intel Mac with Node.js 22. Older runs on the same branch are cancelled. Dependencies are cached; normal checks do not upload artifacts. Documentation changes also run the check so a required status is always reported.

Dependabot opens grouped minor/patch updates weekly and separate major updates. GitHub Actions updates are grouped separately. Review changes and regenerate THIRD_PARTY_NOTICES.md with `python3 scripts/generate-notices.py` when dependencies change. Updates are not merged automatically.

## Prepare a release

1. Use `npm version patch --no-git-tag-version` (or minor/major) to update package.json and package-lock.json. Add the matching version entry to CHANGELOG.md.
2. Merge the version and application changes into main after checks pass.
3. Open Actions → Release → Run workflow, select main, and leave **Create a draft release** off for a build-only validation, or enable it to prepare a release.
4. The workflow tests and builds on Apple Silicon, Intel Mac, and Windows x64, starts each packaged runtime to test IPC, verifies bundle contents and versions, and prepares three ZIPs, combined SHA-256 checksums, and changelog-based notes. Build artifacts expire after one day.
5. Download each app and check installation, startup, OAuth, and AI client registration on its target OS. For a draft release, review its notes and assets, then publish it from Releases. Publication makes the version eligible for the app's update checker.

The workflow never overwrites an existing release. Choose a new version for subsequent releases. A failed build-only run creates no release or tag. Draft publication uses a separate job with write access; build jobs have read-only repository access and do not receive stored credentials.

Standard GitHub-hosted runners are used throughout. Release packaging runs only when this workflow is manually started; there are no scheduled builds. All builds remain unsigned; Mac builds are also unnotarized. Windows distributes a portable app folder rather than an installer.

## Local builds

Use `BUILD_ARCH=x64 npm run build:desktop` on Mac for Intel, or `BUILD_ARCH=arm64` for Apple Silicon.
On Windows PowerShell, set `$env:BUILD_PLATFORM="win32"` and `$env:BUILD_ARCH="x64"`, then run `npm run build:desktop`.
Keep the target environment set while running `node scripts/smoke-package.mjs` and `python scripts/package-release.py`.
The smoke test uses an isolated temporary state directory and port 43139. Its default startup limit is 30 seconds; set `SMOKE_TIMEOUT_MS=180000` for slow emulation or first-launch translation.
Keep the pinned optional build bindings for all release targets in package-lock.json so `npm ci` works on every host.
For offline builds, `ELECTRON_ZIP_DIR` may point to a directory containing the official Electron ZIP
for the exact pinned version and target. Verify that ZIP against Electron's published SHA-256 checksums first.
