# Checks and releases

Pull requests and pushes to main run the tests and UI build on Linux, Windows x64, Apple Silicon, and Intel Mac with Node.js 22. Older runs on the same branch are cancelled. Dependencies are cached; normal checks do not upload artifacts. Documentation changes also run the check so a required status is always reported.

Dependabot opens grouped patch/minor updates weekly, separating routine dependencies from runtime/security-sensitive dependencies. Major updates stay separate; GitHub Actions groups contain only patch/minor updates. Follow the dependency review below before every release. Merges are performed as part of the release review, not by an unattended auto-merge bot.

## Prepare a release

Lead with a recommended release scope and do the assessment, rather than asking
the user to classify every difference. A request for upstream parity authorizes
routine compatible additions and schema fixes after permission and ownership review.
Ask a grouped scope question only for materially broader effects, significant
tradeoffs or unavailable access. Existing scope decisions cover routine execution.
Every review must show supported, missing, outdated, deliberately excluded, deferred
and unverified capabilities for both channels, including previous omissions.
Missing channel access makes the review incomplete: explicitly recommend obtaining
access or releasing with that limitation and obtain a decision before publication.
Do not silently defer candidates or use a clean action diff as proof of full coverage.

1. Complete the Webflow MCP compatibility review and review eligible Dependabot PRs using the procedures below, then use `npm version patch --no-git-tag-version` (or minor/major) to update package.json and package-lock.json. Add the matching version entry to CHANGELOG.md.
2. Merge the version and application changes into main after checks pass.
3. Open Actions → Release → Run workflow, select main, confirm **Stable/Beta MCP changes reviewed** for the selected commit, and leave **Create a draft release** off for a build-only validation, or enable it to prepare a release. Enable **Sign and notarize Mac apps** for Developer ID releases after configuring the signing environment below.
4. The workflow tests and builds on Apple Silicon, Intel Mac, and Windows x64, starts each packaged runtime to test IPC, verifies bundle contents and versions, checks Mac signatures before and after ZIP extraction, and prepares three ZIPs, combined SHA-256 checksums, and changelog-based notes. Build artifacts expire after one day.
5. Download each app and check installation, startup, OAuth, and AI client registration on its target OS. For a draft release, review its notes and assets, then publish it from Releases. Publication makes the version eligible for the app's update checker.

The workflow never overwrites an existing release. Choose a new version for subsequent releases. A failed build-only run creates no release or tag. Draft publication uses a separate job with write access; build jobs have read-only repository access. Only explicitly selected signed Mac builds receive signing credentials from the `mac-signing` environment.

Standard GitHub-hosted runners are used throughout. Release publication runs only when this workflow is manually started; there are no scheduled builds. Dependency, build, and workflow PRs also run credential-free packaging checks. Windows builds remain unsigned. The release workflow defaults to Developer ID signing. Local builds without signing settings, or workflow runs with signing disabled, use ad-hoc signing for credential-free validation. Developer ID mode signs with hardened runtime after all bundle resources are written, notarizes with Apple, and staples the ticket. Missing credentials or failed notarization stop that build; it never falls back to ad-hoc signing. Signing and strict recursive verification failures stop the build; release packaging also verifies the extracted ZIP. Ad-hoc verification checks bundle integrity, not Gatekeeper approval. Developer ID mode additionally verifies the expected signing identity, stapled ticket, and Gatekeeper acceptance after ZIP extraction. Test a browser-downloaded ZIP on a separate Mac before publication, including the Privacy & Security approval flow. Windows distributes a portable app folder rather than an installer.

## Public release notes

Write for people installing or using MCP Router. Use this format for every release:

1. One short introductory sentence explaining the main benefit.
2. **What’s new**: a short list with bold feature labels and plain-language
   descriptions of changes users can notice or act on. Summarize dependency work
   as security or reliability improvements unless a specific version matters.
3. **Install or update**: platform choices, installation/update steps, accurate
   signing status, settings preservation and the checksum filename.

Keep material permission changes, migration requirements and known problems that
users need to act on. Do not substitute testing limitations for known product
problems or imply testing that did not happen. Test counts, fixture details,
compatibility inventories, build/CI incidents, internal prototypes, unfinished work
and dependency deferrals belong in the PR and release-review records, not the
public release description. Those records remain required.

The version section in CHANGELOG.md supplies the public introduction and feature
list. Start it with the introductory sentence and a `### What’s new` heading;
packaging promotes that heading and appends installation guidance. Keep engineering
review details in this guide or the PR. Inspect the generated release-notes.md
before publishing; generated text still needs editorial review. Version 0.9.0's
published notes are the reference for tone and structure.

When correcting historical descriptions, preserve what actually shipped and that
version's platform/signing/update limitations. Edit release text only: never replace
published binaries, checksums or feeds as part of an editorial cleanup.

## Webflow MCP compatibility review before each release

Aim for parity with upstream Webflow workflows while preserving router permissions
and project isolation. Perform this review on the final release commit, separately
for Stable and Beta. This is required for local releases too; ordinary local
development builds do not need a release review.

1. Using an authorized connection for each channel, collect every page of Webflow
   `tools/list` into a complete JSON array. Keep these snapshots in ignored local
   storage, for example `.private-release/webflow-stable.json` and
   `.private-release/webflow-beta.json`. Do not include OAuth grants, session
   identifiers, site content or customer data. Do not switch grants to work around
   a failure. Record capture date, channel and the commit reviewed.
2. Run the read-only comparison for each snapshot:

   ```sh
   node scripts/check-webflow-catalog.mjs stable .private-release/webflow-stable.json
   node scripts/check-webflow-catalog.mjs beta .private-release/webflow-beta.json
   ```

   Exit 0 means no detected action-schema differences, 1 means review is needed,
   and 2 means invalid/incomplete input or a failed check. The report lists added,
   changed and removed actions and unclassified tools. It does not update policy.
   Also inspect the current upstream guide, tool descriptions and top-level schema
   constraints: these are not fully represented in the pinned action catalog, so
   a clean comparison alone is not proof of compatibility. Snapshots must include
   all pages; the checker cannot detect omitted pages in a plain array.
3. Review each difference for actual effects, project targeting, resource ownership,
   embedded code, publishing and deletion. Names such as `get_*` are not proof of
   read-only behavior. New tools/actions may reuse existing permissions after this
   review; users need not approve each tool individually. New permission categories
   or expanded effects require explicit permission-design review and must not be
   silently added to existing saved grants. Review changed optional parameters too.
4. Refresh `src/catalog.json` only with `scripts/build-catalog.py` from a reviewed
   snapshot, updating the generator's classifications and `src/permissions.js`
   ownership checks as needed. The generator's name-based classifications are
   candidates, not approval. Never blindly overwrite the shared catalog with the
   other channel's snapshot: reconcile channel differences explicitly or defer
   incompatible operations. Unclassified runtime tools remain unavailable.
5. Add synthetic regression coverage for changed schemas, permission denial,
   cross-project targeting and Stable/Beta isolation. Run `npm test` and
   `npm run build:ui`. Record supported changes and each deferral with its reason
   in the release PR or release notes. If a channel could not be checked, record
   that limitation explicitly rather than claiming parity.
6. Confirm the workflow's **Stable/Beta MCP changes reviewed** input only after
   completing and documenting the review, including any accepted deferrals or
   unavailable channel checks. The workflow checks this attestation before build
   or signing; it does not contact Webflow or validate the review's conclusions.
   Webflow credentials must not be added to release or PR jobs.

## Local builds

Run `npm run clean:dist` to remove recognized distribution outputs older than the
version in package.json. Successful release packaging runs this cleanup automatically
for local and CI builds. It removes old versioned ZIPs, CI downloads, obsolete app
bundles, stale update feeds and checksums, and release notes without archives.
Current/newer versions, installation backups, icon assets, unknown files and symlinks
are preserved. Cleanup is limited to local `dist`; published GitHub assets are untouched.
Keep anything requiring long-term retention outside `dist`.

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
bumping the app version. After the user includes a newly discovered candidate in
release scope, the release request authorizes merging routine updates that pass
this procedure; separate per-PR merge approval is unnecessary.
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

For the reviewed compatibility refresh, run
`python3 scripts/build-catalog.py --refresh-compatible STABLE.json BETA.json`.
This updates only explicitly reviewed shared actions and the five Analyze
actions shared by Stable and Beta, preserving permission classifications. Shared schemas must match between
channels. Extend the reviewed set only after reviewing effects and ownership;
new families and site-branch actions are not automatically imported.

The CMS creation refresh includes a narrow correction for the upstream output-
schema export: only the name/slug object inside the two fieldData intersections
is reopened to custom field slugs. The generator checks the expected shape and
stops if it changes. Catalog comparison intentionally still reports this schema
difference; review it rather than suppressing unexpected upstream changes.

Refresh the explicitly reviewed Beta site-branch operations separately with
`python3 scripts/build-catalog.py --refresh-site-branches STABLE.json BETA.json`.
This preserves Stable page creation and stores the Beta page-creation schema
separately. Runtime schema validation and comparison select the project's channel.
The four lifecycle actions use Pages read/write/publish/delete permissions, with
project ownership checks before staging, discarding or creating a branch page.

Refresh the reviewed site-scoped analytics reads with
`python3 scripts/build-catalog.py --refresh-site-reads STABLE.json BETA.json`.
The explicit allowlist includes AEO reads on both channels and recommendation
reads on Beta, under Analytics read. Recommendation settings writes and unreviewed
families are excluded. Schema/channel/targeting changes stop the generator for
review. Optimize resource discovery is account-wide; do not expose it or trust a
caller-supplied resource ID without a verified project mapping.

### Interactions and upstream coverage review (2026-10-15)

A complete live Stable `tools/list` capture contained 37 tools. The six
`data_interactions_tool` actions are now classified under Interactions (GSAP),
with separate read/write/delete grants. Create/update additionally require custom
code write; mutations require instruction read and preparation. The upstream
`webflow://guides/interactions` resource was reviewed for scope, target and payload
semantics. No site content was changed during discovery. Regenerate this family
from a freshly reviewed complete Stable snapshot with:

```sh
python3 scripts/build-catalog.py --refresh-interactions STABLE.json
```

The generator imports only the six named actions and checks envelope requirements.
Review schema changes before running it; it is not an automatic approval mechanism.
Beta had no authorized grant available for this review, so interactions remain
Stable-only and no Beta parity claim is made.

The follow-up scope explicitly includes the other 56 Stable actions:

| Family | Actions | Router policy |
| --- | ---: | --- |
| Apps | 18 | Site-pinned creation, app/environment/deployment ownership, separate Publish and sensitive-data Read grants |
| Campaigns | 20 | Site/campaign/variation ownership, filtered workspace discovery, page/asset prerequisites |
| Members | 10 | Four site-access actions plus six workspace actions with separately saved, default-off workspace grants |
| Optimize | 8 | Filtered account discovery and verified Webflow site/optimization mapping |

Refresh these families and the five reviewed Modal schemas with:

```sh
python3 scripts/build-catalog.py --refresh-project-tools STABLE.json
```

This generator has explicit action allowlists, checks envelope requirements, and
preserves Beta's prior schemas. It does not approve future upstream changes.
Stable `create_prop`, `update_prop`, `set_component_instance_prop_values`,
`set_settings`, and `data_element_builder.build` now include modal-link settings
and the Modal element type. Existing canvas/custom-code prerequisites remain.
No existing Stable action was removed.

The final Stable comparison has no missing actions, unclassified tools or removed
actions. Its only schema difference is the deliberate CMS fieldData export
correction documented above. Do not suppress that difference globally. Utility
tools and owner-only `list_sites` remain deliberately outside agent execution.
App creation always attaches to an approved site; account discovery returns only
project-scoped results. Workspace member operations are the sole explicit
workspace-wide exception, controlled outside project permissions.

Beta still has no authorized grant available for this review: no new family or
Modal schema is enabled there and no Beta parity claim is made. The review used
live schema/guide metadata and synthetic execution fixtures, not mutations of
customer sites. This dated review is not a substitute for final-commit checks
before a release.

### Beta coverage follow-up (2026-10-15)

A complete authorized Beta capture contained 39 tools. The reviewed five families
(62 actions including Interactions) and five Modal schemas now support both channels.
Beta adds account-wide workspace discovery and standalone Cloud app creation,
including folder/access controls, under separate default-off connection permissions.
Standalone creation is an explicit alias of create_app without site_id; Webflow
chooses the destination workspace and enforces folder/access authorization. It does
not grant subsequent project access to the created site. Existing create_app remains
site-pinned. AEO recommendation settings use a separate project write permission.
The user explicitly included all these capabilities in release scope.

Regenerate with `python3 scripts/build-catalog.py --refresh-beta-tools STABLE.json BETA.json`
after the Stable family refresh. The generator rejects unreviewed cross-channel
family differences. Both comparisons retain only the known CMS fieldData correction.
Utility tools and owner-only list_sites remain excluded by design. No channel is
unverified in this review. Review metadata and checks again on the release commit.

### Source-bound coverage report

After staging the final source files and completing both channel reviews, run
`node scripts/check-release-review.mjs --record STABLE.json BETA.json` and stage
`docs/release-review.json`. This records schema snapshot hashes, tool/operation
counts, gaps, exclusions and accepted differences without provider payloads.
The release workflow runs `node scripts/check-release-review.mjs` and rejects a
missing, stale (over seven days), incomplete or source-mismatched report. The digest
covers all tracked files except the report itself, so it binds to the final source
tree without a self-referential commit hash. Any later tracked change requires a
renewed review. Hashes do not establish review quality: the agent must still inspect
guides, tool descriptions, envelopes, effects and ownership. The recorder refuses
unknown differences; changed exclusions require explicit review, never a blind bypass.

### Optimize compatibility follow-up (2026-10-16)

Fresh, fully paginated captures contained 37 Stable tools and 39 Beta tools,
using each channel's existing authorization separately. Compared with the
October 15 captures, only five Optimize action descriptions changed. The three
performance reports now document accepting goals from `currentGoals`; goal
listing and optimization listing explain current versus historical goals.
Request constraints, tool envelopes, permission scope and ownership targeting
are unchanged. Regenerate with the project-tools and beta-tools commands above.

Both channels include 12 Analyze, 14 AEO Analytics and eight Optimize read
actions. Analyze and AEO use Analytics Read; Optimize requires its separate
Optimize Read grant. Discovery filters account resources to verified Webflow
site mappings, and individual reports verify optimization membership with
pagination, including archived optimizations. Existing saved permissions do
not automatically gain Optimize access. No additional permission category or
upstream operation was introduced by this follow-up.

Both full catalog comparisons retain only the documented CMS fieldData export
correction, with no added, removed or unclassified operations. Tool descriptions
and complete input schemas were also compared with the prior reviewed captures;
the current guides retain read-only analytics semantics and upstream entitlement
and concurrency limits. Utility tools and owner-only list_sites remain excluded
by design. No new capability was deferred and neither channel was unavailable.
This is schema and synthetic execution validation, not live analytics-report
validation on an entitled site.

The release review in `docs/release-review.json` binds both channel outcomes to
the staged release source. No open Dependabot PRs were present. No UI or dependency
changes are included in this follow-up; native prototype and manual resync work
remain separate from this release.

### 0.9.0 release review (2026-10-26)

Complete, separately authorized Stable (37 tools) and Beta (39 tools) inventories,
top-level envelopes, tool descriptions and guides were reviewed. Stable is
unchanged. Beta adds five component-slot actions and two Release actions; its
stage/discard descriptions and branch-scoped page-list schema were refreshed.
The explicit `--refresh-site-branches STABLE.json BETA.json` generator allowlist
now includes these seven Beta actions. Component-slot operations require owned
components, slot definitions/default roots and exact instance element pairs;
Release operations use existing branch ownership checks. Clear/removal require
Delete, and reset requires both Write and Delete. No new permission category.
The only accepted schema difference remains the narrow CMS fieldData correction.
Utility tools and owner inventory remain excluded by design in Managed mode.
Direct is separately owner-enabled and intentionally exposes live tools under
the selected grant; no Managed failure switches modes or channels.

Dependency review: include Dependabot #38's compatible React/Radix/Lucide/Vite
updates and #36's Hono 4.13.13 patch. Lockfile inspection found no new install-script
flags or non-npm registries. Changes are UI behavior/type fixes, build fixes, and
Hono's static-path security correction; this app uses its own HTTP server rather
than Hono's static middleware. Refresh notices and verify dialogs and packaged
runtimes. Keep #37 (TOML, Zod, notarization) separate for configuration/schema and
signed-updater integration validation; its notarization update also changes
package preparation metadata. Keep #35 (Motion 14) and #32 (setup-node 7) separate
as major upgrades. Native demo and read-code prototype are development work,
not production release candidates. No dependency PR is closed until its
replacement has merged.

Validation uses synthetic fixtures and fictional UI captures. New Beta mutations
have not been exercised against live customer content or an entitled Releases
site. Installed signed Mac login-item enable/disable and app-restart persistence
were checked; actual sign-in launch and Windows login require manual validation.

### 0.9.0 security follow-up (2026-10-26)

The refreshed advisory scan identified additional fixes before publication. The
user included them in scope: Electron 44.9.3, Zod 4.6.7, body-parser 2.4.0,
fast-uri 3.1.9, ip-address 10.7.5, undici 7.30.1 and qs 6.16.1. The prior build
was cancelled before creating a release; the version remains 0.9.0.

Electron stays on major 44 and includes upstream browser/runtime security fixes
and the eMudhra certificate mitigation. Zod bounds constrained collection error
work. Body-parser fixes compressed input handling and adds zstd support when the
runtime supports it; the router's owner HTTP server uses its own body limits.
Fast-uri rejects ambiguous schemes/hosts and corrects relative normalization.
IP parsing now rejects pathological zones in linear time, with additional Teredo
flag corrections. Undici includes decompression, streaming and integrity fixes;
qs corrects parsing/encoding and bounds nested conflict handling. Review covered
upstream release notes and the lockfile diff: only these seven package versions
changed, all npm registry URLs and licenses remain consistent, and no new install
lifecycle flag was introduced. Electron exposes explicit binary installation
instead of a postinstall script; packaging downloads its exact pinned runtime.
Node 22.14 locally and Node 22 CI satisfy the new minimum of 22.12.

The complete Stable/Beta inventories and guide review above remain current; no
catalog or permission changes were needed for this follow-up. Refresh the source-
bound attestation after the dependency and documentation changes. npm audit reports
zero known vulnerabilities. Validate the full suite, UI build, packaged runtime,
Developer ID signing/notarization and isolated signed updater before publication.
Zod from #37 is included; its TOML and notarization updates remain deferred pending
separate review, so that mixed PR is not fully superseded. Major upgrades #35 and
#32 remain separate. No advisory is deliberately left unresolved in this lockfile.

### 0.9.1 branding and Beta history review (2026-10-28)

The release contains the purple app icon, stronger menu-bar variants with a gap
above workspace nodes, and the wordmark without the standalone symbol. README
screenshots were recaptured from the release source using fictional data.

Fresh, completely paginated captures contain 37 Stable tools and 39 Beta tools.
Stable schemas and tool descriptions are unchanged from the reviewed baseline.
Beta adds `data_pages_tool.list_site_branch_changes` and refreshes the
`list_site_branches` description with change summaries. Full envelope comparison
found no new top-level targeting or constraints. The guides also clarify campaign
name length (10–24 characters); Beta explains Release change history and existing
branch lifecycle behavior. Existing Beta slot/freshness/detail schemas match the
0.9.0 catalog. No additional changes were found.

The explicitly approved Beta addition is read-only metadata (resource names, IDs,
types, locales and contributors), uses existing Pages Read, and stays site-pinned.
Branch membership is verified in the selected site's in-progress Releases or,
for change history only, paginated merged history. Foreign branches, malformed
responses, repeated/missing cursors and pagination exhaustion fail closed.
Merged history does not authorize branch mutations or working-page reads. List
pagination parameters require the merged status group. The generator was updated
and the catalog regenerated; no new permission category or automatic grant was
introduced. Synthetic tests cover permission denial, Stable isolation, site
injection, ownership, short/empty pages, malformed pagination and loop bounds.
Live lifecycle operations on entitled customer sites were not exercised.

Coverage: Stable supports 304 operations and Beta 324. Neither channel has missing,
removed, unclassified or unexpectedly outdated actions after this refresh. The
only accepted schema difference is the existing narrow CMS fieldData export
correction. Guidance/discovery utility tools and owner-only site inventory remain
excluded by design in Managed mode. No capability is deferred or unverified at
the schema-review level. The source-bound report records the final tree.

Open dependency PRs were reviewed by manifest/lockfile/workflow diff. Keep #47
(TOML 3.3.1 and notarize 3.1.2) separate: it changes configuration editing and
notarization behavior, including upstream prepare metadata, and needs focused
configuration and signed-updater validation. Its lockfile changes only those two
packages, retains MIT licensing and npm registry URLs, and adds no transitive
packages. Keep #35 (Motion 14.6.0 and its three runtime packages) separate for major
animation migration/UI checks. Keep #32 (setup-node 7.1.0) separate for action
migration and credential-free packaging validation. Neither major is needed for
this branding release. No dependency was changed; npm ci reports zero known
vulnerabilities for the retained lockfile. None of these PRs is superseded or
closed. The separate Mac installation PR and local development prototypes are
outside this release.

### Code-mode release review (2026-10-29)

Recommended scope: read-only code mode, its default-on owner preference, and its
regression/packaging checks. Existing OAuth grants, permissions, pinned operations
and ownership logic are retained. No upstream operation or grant is added.

Fresh read-only metadata captures fully paginated 37 Stable and 39 Beta tools
through the existing application provider, separately per grant, without refreshing
or exporting credentials. Both comparisons against this release's catalog report
no added, removed or unclassified actions. The only schema difference on either
channel is the existing deliberate CMS create_collection_items fieldData export
correction. It remains intentionally different. Utility tools and owner list_sites
remain excluded by design. No channel was unavailable.

Compared with the October 16 capture, top-level schema constraints and Stable tool
descriptions are unchanged. Beta's Pages description now mentions Release change
history and site-branch targets, already covered by the 0.9.1 catalog and ownership
checks. The current guide preserves the read-only CMS listing workflow used here.
This is metadata compatibility, not a claim to have live-tested every operation.

Open dependency PR diffs were reviewed. #51 changes only TOML patch 3.3.0→3.3.1,
MCP SDK 1.32.1→1.32.2 and notarize 3.1.1→3.1.2 entries, with no transitive lockfile
changes. It is deferred as a separate runtime/signing-sensitive update requiring
configuration, MCP and signed-package validation. #35 (Motion 13→14) and #32
(setup-node 6→7) are major upgrades deferred for separate migration review.
No dependency PR is merged or closed as part of code mode. QuickJS 0.32.0 is pinned
and its MIT license notices regenerated. npm audit reports an existing moderate
@hono/node-server serveStatic advisory; the router and MCP SDK server do not use
that static-serving function. This is not a code-mode dependency or a newly
introduced reachable path; track its patch independently rather than claim a
clean dependency audit.

Local source checks pass 228 tests with the Windows ACL check skipped on macOS;
the UI build passes with the existing chunk-size warning. Code-mode preference
coverage includes persistence, owner authentication, Origin/CSRF protection,
non-boolean rejection, denied MCP setting changes, and disabling/re-enabling during
an in-flight read. The CI package matrix now runs smoke-read-code.mjs after the
ordinary packaged daemon smoke on macOS arm64, macOS x64 and Windows x64.

The setting only changes an unopened menu and is not visible in either existing
README screenshot; those screenshots do not need regeneration for this change.
Final release publication still requires the normal CI, packaged runtime, signing
and platform checks above. See CODE_MODE_BENCHMARK.md for bounded live evidence
and its limits; no measured model-token or guaranteed speedup claim is made.
