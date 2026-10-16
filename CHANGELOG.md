# Changelog

## 0.8.12 — Optimize guidance and release cleanup

- Refresh five Optimize action descriptions on Stable and Beta to explain current versus historical goals.
- Correct the usage guide: all eight Optimize read actions are available under the separate Optimize Read permission, with site and experiment ownership checks.
- Add regression coverage for paginated experiment ownership, filtering of final discovery responses, separate read grants and permission revocation.
- Add safe distribution cleanup after successful packaging and a `npm run clean:dist` command; preserve current/newer builds, backups and unknown files.

Compatibility: fresh complete captures of 37 Stable and 39 Beta tools show no
missing or unclassified actions. The only accepted schema difference remains the
reviewed CMS fieldData correction. Utility tools and owner-only site inventory
remain excluded by design. No permissions, grants or request constraints change.

## 0.8.11 — Complete reviewed Webflow capabilities

- Add GSAP interactions, Cloud Apps, Campaigns, Optimize and site/member access tools on Stable and Beta.
- Add separate default-off workspace-member and account-wide Beta grants for workspace discovery and standalone app creation, including access/folder controls. Preserve all existing saved grants.
- Add Beta AEO recommendation settings writes and refresh five Modal element/link schemas on both channels.
- Verify site, app, campaign, interaction, member and Optimize ownership before dispatch; filter broader discovery responses to approved scope unless account-wide access is explicitly granted.
- Close screenshot capture sessions gracefully and document the required desktop launch environment.
- Require recommendations and an explicit coverage report during release review; reject stale or source-mismatched reports in release builds.

Compatibility: 37 Stable and 39 Beta tools reviewed from complete authorized captures.
No missing classified actions or unexpected schema differences; the existing CMS
fieldData export correction remains intentional. Utility tools and owner-only site
inventory remain excluded from agent execution. New writes have synthetic permission
and ownership coverage; no customer resources were mutated for release testing.


## 0.8.10 — Reliable preparation and clearer Mac setup

- Load enabled project rules and a skill index during preparation; fetch relevant skill bodies on demand instead of downloading every skill.
- Retry explicitly transient preparation reads once and report safe failure stages without exposing provider payloads. Writes remain non-retrying.
- Offer to move downloaded Mac apps into Applications before setup, with an option to remember the user's preference.
- Show a menu-bar indicator when a signed update is ready to install, while preserving access-warning priority.
- Require a documented Stable/Beta Webflow MCP compatibility review before releases and provide a read-only catalog comparison command.
- Update Lucide and Vite and refresh third-party notices.
- Update the pinned GitHub checkout action to 7.0.1.
- Migrate to Zod 4 with explicit string keys for Webflow operation parameters.
- Update Electron, the MCP SDK, AJV, TOML parsing and the Mac signing helper with security hardening and compatibility fixes.

Compatibility review: refresh shared CMS, component, popover and element schemas;
add five Analyze reports on Stable and Beta under Analytics → Read, with channel and
project ownership checks. Correct the CMS creation schema export so custom fields
remain accepted inside fieldData. Live Stable verification confirmed custom-field
roundtrip and cleanup using the legacy creation format; the new format has
synthetic coverage. Include experimental Beta Releases support for accounts with
Webflow beta access, using separate Pages read/write/publish/delete permissions
and project ownership checks. Releases have synthetic coverage only; live
validation remains pending access to an eligible project.

Add site-scoped AEO reports and prompt history on Stable and Beta, and read-only
AEO recommendations on Beta, under Analytics → Read. Upstream entitlement gates
still apply. Optimize, Cloud Apps, Campaigns, Interactions, Members, workspace
operations and recommendation settings writes remain outside this release.

## 0.8.9 — OAuth security and dependency maintenance

- Update the MCP SDK to bind saved OAuth credentials to their authorization server, while preserving Webflow-only requests and separate Stable/Beta grants.
- Update UI dependencies with fixes for focus and interaction in nested dialogs and popovers.
- Refresh build dependencies and third-party license notices.
- Validate packaged app startup and bundle integrity across Apple Silicon, Intel Mac, and Windows before merging dependency updates.

## 0.8.8 — Signed Mac releases and automatic updates

- Sign and notarize Mac releases with Developer ID and verify the delivered ZIP.
- Download signed Mac updates in the background and install on quit or with Restart to update.
- Publish update feeds for Apple Silicon and Intel Macs; retain manual downloads on Windows.
- Existing installations need one manual installation of this signed version to enable future automatic updates.

## 0.8.7 — Faster discovery and clearer access recovery

- Advertise MCP tools immediately and fetch Webflow guidance on demand for the selected project.
- Give agents specific Router permission errors and safe recovery guidance without exposing provider payloads.
- Provide short-lived, single-use reauthorization links while keeping Stable and Beta grants separate.
- Keep permission toggles and presets editable when upstream authorization is missing.
- Support current macOS ChatGPT/Codex CLI locations and open the releases page from update notifications.
- Align connection and project status badges, refresh screenshots, and expand recovery checks and documentation.

## 0.8.6 — Menu bar access in fullscreen

- Allow the macOS menu bar window to open while another app is fullscreen.

## 0.8.5 — Clearer access warnings

- Keep healthy views quiet and show compact warning badges on affected connections and projects.
- Explain access issues on hover or keyboard focus, with scoped recovery actions when opened.
- Show ready-versus-enabled counts in the menu bar tooltip only when access needs attention, and add a warning variant of the menu bar icon.
- Use shared readiness checks across the dashboard and menu bar while preserving separate Stable and Beta grants.
- Add interaction checks for keyboard navigation, filtered projects, pending checks, and recovery; refresh screenshots and documentation.

## 0.8.4 — Smoother interface and connection testing

- Animate changing text, icons, project filtering and ordering, expanding sections, scrollbars, and popups while respecting reduced-motion preferences.
- Keep long project names within their rows and refine compact-window dialogs and controls.
- Allow owner connection tests for disabled projects without enabling AI access, with clearer test feedback.
- Let AI name searches discover disabled project names, with a setting to disable discovery; project content remains inaccessible until enabled.
- Refresh demo coverage, documentation, screenshots, and third-party notices.

## 0.8.3 — Clearer permissions and compact controls

- Add icons to permission presets and a Read & write preset that excludes Delete and Publish.
- Show compact permission and Beta indicators with tooltips and shortcuts to project settings.
- Align compact controls, retain publisher branding, and share button feedback with the connection chevron.
- Move Sync projects into the connection menu and rename Connection access to Reconnect Webflow.
- Improve singular project and connection labels and remove redundant disabled-project helper text.
- Add an interactive, isolated demo with native menus and in-memory changes that reset on exit.

## 0.8.2 — Animated project ordering

- Animate projects sliding into place when enabling, disabling, pinning, or renaming changes their order.
- Respect reduced-motion preferences and preserve the existing project sorting rules.

## 0.8.1 — Reconnect disabled connections

- Allow Stable and Beta authorization and reconnection while a connection is turned off.
- Refresh the authorized project inventory without enabling AI access or background sync.
- Keep owner authorization active when a connection is switched off during the browser flow.

## 0.8.0 — Menu bar access and clearer controls

- Add a macOS menu bar panel with optional project and connection counts, updated when saved state changes. The default shows the app icon and project count.
- Use native desktop menus with icons and submenus that can extend beyond the window.
- Add a compact project layout and full-space permission editing in the menu bar panel.
- Clarify Stable and Beta connection access, with explicit authorization and reconnect actions.
- Show AI-app setup status with checkmarks and warnings, plus separate setup and reconnect actions.
- Refine project links, toolbar controls, Beta labels, and connection-test loading feedback.
- Keep available-update notifications visible until dismissed.

## 0.7.8 — Stable pinned project order

- Keep pinned projects in alphabetical order when turned on or off.

## 0.7.7 — Live Webflow guidance and connection improvements

- Forward Webflow's live server instructions and tool descriptions to AI clients, scoped to enabled projects and their selected Stable or Beta grants.
- Expose current Webflow guidance, project rules and skills through MCP tools and project resources while retaining reviewed operation schemas and permission checks.
- Prompt for a connection name after its first successful project discovery.
- Clarify MCP version selection and show the current default in project settings.
- Keep successful AI-app connection feedback visible until the next hover or keyboard focus.
- Explain update-check failures with safe connection, timeout and rate-limit messages.
- Refresh the project overview and permissions screenshots.

## 0.7.6 — Mac installation fix

- Ad-hoc sign completed Apple Silicon and Intel Mac bundles to fix invalid signatures that could produce the macOS “app is damaged” warning.
- Verify Mac signatures during builds and again after extracting release ZIPs.
- Clarify installation approval for Mac builds without an Apple Developer ID or notarization.

## 0.7.5 — Windows and Intel Mac support

- Prevent blank Windows startup windows by keeping permission checks asynchronous.
- Improve project access management, permission availability, and Stable/Beta grant handling.
- Detect Microsoft Store ChatGPT/Codex and preserve existing TOML settings when connecting.

- Add Intel Mac and Windows x64 release targets alongside Apple Silicon.
- Integrate native Windows window controls into a single app header.
- Use authenticated named pipes and protected state-directory permissions on Windows.
- Detect common Windows AI client installations and safely launch npm-installed Codex.
- Test all supported hosts in CI and smoke-test packaged runtimes before releasing.

Changes are listed newest first.

## 0.7.4 — Update notifications

- Check public GitHub releases on startup, every six hours and on demand.
- Offer a release-page download button for newer stable versions.
- Add macOS installation and manual-update instructions to the README.

## 0.7.3 — Consistent naming

- Move desktop data to `MCPRouter` with automatic migration.
- Rename the macOS bundle and icon assets to MCP Router identifiers.
- Rename AI-client registration to `mcp_router_for_webflow`, preserving settings.

## 0.7.2 — Security hardening

- Require an owner session for local dashboard access.
- Add private, expiring one-use developer browser login.
- Restore private vault/key permissions and safely reject malformed URLs.
- Restrict packaged contents to runtime assets and required notices.

## 0.7.1 — [Kvalifik](https://kvalifik.dk) branding and license viewer

- Add the [Kvalifik](https://kvalifik.dk) wordmark and website link to the header and About panel.
- Add About to Settings and the native app menu.
- Add a local, read-only third-party license viewer covering app dependencies, Electron, and Chromium.
- Support local SVG assets with the correct content type.

## 0.7.0 — GitHub release preparation

- Rename the app to MCP Router, with [Kvalifik ApS](https://kvalifik.dk) as publisher.
- Add licensing, privacy, usage, security, contribution, and branding documents.
- Replace unverified third-party integration logos with neutral icons.
- Retain legacy state paths and registration keys for compatibility.
- Exclude private development material and credentials from source/release artifacts.
- Include third-party and runtime license notices in packaged apps.
