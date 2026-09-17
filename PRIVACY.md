# Privacy notice

Last updated: 16 September 2026

## Publisher and contact

MCP Router is developed by [Kvalifik ApS](https://kvalifik.dk). Contact contact@kvalifik.dk for privacy
questions, requests, or concerns. This notice covers the unmodified local app
and information you voluntarily send to [Kvalifik ApS](https://kvalifik.dk) for support. Modified
versions and third-party services may behave differently.

## Local processing

The app stores OAuth client registrations, access/refresh tokens, project and
workspace metadata, local labels, permissions, preferences, and a limited local
audit history on your computer. Tokens and router state are encrypted with
AES-256-GCM. The encryption key is stored alongside the vault with restricted
file permissions; this is not Keychain-backed storage and does not protect
against someone with equivalent access to your OS account.

The app does not intentionally send product analytics, crash reports, tokens,
or project data to [Kvalifik ApS](https://kvalifik.dk). There is no [Kvalifik](https://kvalifik.dk) account or hosted routing
backend in this version. This does not mean that all processing stays on your
computer: Webflow and your AI client receive the information needed for calls.

## Information sent to other services

OAuth registration and authorization communicate with Webflow. Registration
metadata includes a local connection label, endpoint selection, and a short
connection identifier. Requests and necessary credentials go to Webflow's MCP
service. Project data, instructions, operation arguments, and responses may
pass between Webflow and the AI client you connect. That client may send data
to its own cloud/model provider according to its configuration and terms.
MCP Router does not control those providers' retention or training policies.

Opening authorization, project links, or app download links opens the relevant
provider's website, where its privacy and cookie policies apply. GitHub handles
repository visits, downloads, and issues under its own policies.

## Local configuration, logs, and retention

Connecting an AI app writes the router's executable/socket configuration to
that client's settings. The app preserves unrelated settings and may create a
private backup of the original configuration. Such backups can contain
unrelated sensitive settings; they stay local and are not sent to [Kvalifik](https://kvalifik.dk).
Copy configuration places local paths on the system clipboard.

The encrypted audit history is limited to the latest 200 events and includes
timestamps, identifiers, and operation/status information. It is not intended
to retain full tool responses. Operational error messages and browser session
state may also exist locally. Local files persist until deleted; OS backups
may retain older copies according to your backup settings.

Deleting a connection removes its current local credentials and project
settings. It does not delete Webflow projects or guarantee server-side token
revocation. Revoke the relevant authorization in Webflow as well when needed.
For complete local removal, quit the app, remove its client registrations and
configuration backups as appropriate, and delete
`~/Library/Application Support/MCPRouter/`. Source-server users should also
remove their configured data directory (by default `.local/`). Deleting the
app bundle alone does not remove these files. These actions do not delete data
already received by Webflow or an AI provider.

## Support correspondence

If you email [Kvalifik ApS](https://kvalifik.dk), we receive your email address and the information you
send. We use it to respond, investigate issues, and administer licensing or
privacy requests, based on our legitimate interest in handling those requests;
applicable legal obligations may also require retention. We retain information
only as long as needed for those purposes and applicable obligations. Our email
service processes correspondence on our behalf. Do not send tokens, private
vault files, or confidential client content.

Where applicable, you can request access, correction, deletion, restriction,
portability, or object to processing by contacting us. You may complain to the
Danish Data Protection Agency (Datatilsynet) or your competent supervisory
authority. Requests concerning Webflow, GitHub, or your AI provider should also
be directed to that provider. We cannot access or erase copies held by them.

## Updates

Changes to data handling will be reflected in this notice. Review the notice
included with the version you use.

## Update checks

The desktop app checks GitHub’s public API for releases from Kvalifik/mcp-router
on launch, every six hours while running, and when you choose Check for updates.
GitHub receives your IP address and standard request metadata. No Webflow tokens,
project information or router settings are sent. Download update opens the
GitHub release page in your browser. The app does not install updates itself.
