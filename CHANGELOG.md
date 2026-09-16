# Changelog

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

## 0.7.1 — Kvalifik branding and license viewer

- Add the Kvalifik wordmark and website link to the header and About panel.
- Add About to Settings and the native app menu.
- Add a local, read-only third-party license viewer covering app dependencies, Electron, and Chromium.
- Support local SVG assets with the correct content type.

## 0.7.0 — GitHub release preparation

- Rename the app to MCP Router, with Kvalifik ApS as publisher.
- Add licensing, privacy, usage, security, contribution, and branding documents.
- Replace unverified third-party integration logos with neutral icons.
- Retain legacy state paths and registration keys for compatibility.
- Exclude private development material and credentials from source/release artifacts.
- Include third-party and runtime license notices in packaged apps.
