# Changelog

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
