# Checks and releases

Pull requests and pushes to main run the tests and UI build on Linux with Node.js 22. Older runs on the same branch are cancelled. Dependencies are cached; normal checks do not upload artifacts. Documentation changes also run the check so a required status is always reported.

Dependabot opens grouped minor/patch updates weekly and separate major updates. GitHub Actions updates are grouped separately. Review changes and regenerate THIRD_PARTY_NOTICES.md with `python3 scripts/generate-notices.py` when dependencies change. Updates are not merged automatically.

## Prepare a release

1. Use `npm version patch --no-git-tag-version` (or minor/major) to update package.json and package-lock.json. Add the matching version entry to CHANGELOG.md.
2. Merge the version and application changes into main after checks pass.
3. Open Actions → Release → Run workflow, select main, and leave **Create a draft release** off for a build-only validation, or enable it to prepare a release.
4. The workflow tests and builds on Apple Silicon, verifies bundle contents and versions, and prepares a ZIP, SHA-256 checksum, and changelog-based notes. Build artifacts expire after one day.
5. Download the app and check installation and startup. For a draft release, review its notes and assets, then publish it from Releases. Publication makes the version eligible for the app's update checker.

The workflow never overwrites an existing release. Choose a new version for subsequent releases. A failed build-only run creates no release or tag. Draft publication uses a separate job with write access; build jobs have read-only repository access and do not receive stored credentials.

Standard GitHub-hosted runners are used throughout. macOS runs only when this workflow is manually started; there are no scheduled builds. The app remains unsigned and unnotarized.
