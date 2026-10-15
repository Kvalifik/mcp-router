# Security policy

## Report privately

Email **contact@kvalifik.dk** with the subject **MCP Router security report**.
Please include the version, affected component, impact, and reproduction steps
using dummy data. Do not post exploitable details, tokens, vault files, or client
content in a public issue. We do not currently promise a response deadline or
operate a paid bug-bounty program.

## Supported versions

Security fixes target the latest release; older versions do not have a
guaranteed support period.

## Security model

- A local daemon holds OAuth credentials; stdio clients receive router tools.
- State is encrypted with a file-based key, not macOS Keychain.
- The management interface requires an owner session, binds to loopback, and
  checks Host/Origin and CSRF headers; the renderer uses Electron isolation and sandboxing.
- OAuth credential storage preserves the SDK's authorization-server issuer binding.
  All OAuth and MCP requests, including legacy credentials without an issuer,
  remain restricted to `https://mcp.webflow.com` and cannot follow redirects.
- OAuth uses PKCE and browser-bound, one-use state; Stable and Beta grants are
  separate. Owner-initiated authorization and its project inventory check can run
  while a connection is off; AI calls and background sync remain blocked.
- AI project-name searches expose matching disabled project names by default,
  but no IDs, permissions, or content. The owner can disable this in Settings.
  Disabled connections and unavailable or deleted projects remain hidden.
  Discovery uses local inventory and does not grant execution access.
- Router permissions restrict calls independently of Webflow authorization. The
  router cannot inspect the full upstream permission grant; Webflow enforces it.
- The pinned operation catalog and project ownership checks reject unknown or
  disallowed operations. These controls require ongoing review as Webflow evolves.
- Webflow server instructions and tool descriptions are fetched live for enabled
  projects with instruction-read access, using each project's selected grant.
  They are guidance, not permission grants: executable schemas and ownership
  checks remain pinned and reviewed. Project guidance resources use the same
  checks as preparation; arbitrary upstream resource URIs are not proxied.
- Preparation loads enabled rule bodies and a skill metadata index. Agents must
  fetch relevant skills through the existing permission-checked instruction read
  operation; the preparation ID does not attest that the agent read those skills.
  Unknown instruction kinds remain eagerly loaded. Rule references are not
  automatically expanded; agents must read references required by those rules.

This is a single-user convenience and policy tool, not a security boundary
against the OS account owner, privileged software, or an agent able to edit local
files. It is not a hosted multi-tenant authorization service. Connected AI clients
can receive sensitive project content and provider-supplied instructions.

## Before sharing diagnostics

Remove identifiers, URLs, customer names, credentials, and request/response
content. Never share `.local/`, `.private-release/`, `vault.key`, `vault.enc`,
client configuration backups, or Application Support data. If credentials may
have leaked, revoke the authorization at Webflow and reconnect.

### Windows builds

Windows state directories use a protected ACL granting the current user full access.
The local named pipe requires a random per-launch token stored inside that directory;
client configuration contains the directory path, not the token. POSIX file modes are
not relied upon for Windows access control. This does not protect against the same
OS user, administrators, or software running as that user.

The owner-authenticated dashboard can test saved Site → Read access for a disabled
project without enabling it. This diagnostic is not an MCP tool and retains the
saved channel, OAuth authorization, connection status, and project permission
checks. Disabled projects remain inaccessible through MCP.

Agent recovery exposes a short-lived, single-use OAuth launch link through the
private MCP IPC channel for an enabled project and connection. It never exposes
owner dashboard credentials or OAuth tokens. Opening the link rechecks project
policy and the selected Stable/Beta grant before starting the existing PKCE and
browser-bound OAuth flow; the user must complete consent. Pending authorization
on either grant is not displaced. Merely requesting a link leaves tokens intact.
Errors crossing MCP use safe router-authored codes and recovery guidance, never
raw provider errors or request payloads. Unknown failures do not imply that
reauthorization is necessary.

Operation diagnostics use router-defined stages and error codes, numeric HTTP
statuses and allowlisted failure categories, never provider messages or payloads.
Preparation/guidance reads may retry once on an explicit transient failure after
rechecking project policy, on the same grant. Authorization failures and project
operations are not retried; incomplete preparation cannot authorize a write.

### Release signing

Developer ID releases sign nested Mac code with Electron's per-binary entitlements
and hardened runtime, then require Apple notarization, a stapled ticket, and
Gatekeeper validation of the extracted ZIP. Signing does not alter the renderer's
sandbox or local authorization controls. Ad-hoc builds remain available for testing
and are identified in release notes. Signed builds fail instead of falling back
when credentials or notarization are unavailable.

Signing keys and notarization credentials belong in macOS Keychain or the protected
GitHub `mac-signing` environment. Only manually requested signed Mac release jobs
receive them, in a temporary keychain removed after the job's packaging steps.
Developer ID Mac builds use Electron's native Squirrel updater. It verifies the
replacement app against the running app's signing requirement before installing
on quit or explicit restart. Feeds are derived from the configured GitHub
repository, detected stable release tag, and native architecture; renderer IPC
accepts no update URLs or file paths. Ad-hoc and Windows builds use manual downloads.
Release metadata also supplies ZIP SHA-256 and size. A compromised signing key or
approved release workflow can still produce trusted malicious releases.

Beta Releases are channel-gated and use separate Pages read, write, publish and
delete grants. The router checks site-branch membership before dispatching an
operation targeting an existing Release, and checks origin-page ownership on
creation. Stable cannot accept the Beta-only branch target in page creation.

Site-scoped AEO and recommendation reads use Analytics read. The router injects
the selected site and rejects site overrides; page and collection filters require
project ownership. Recommendation settings writes require a separate Beta project grant. Optimize discovery is reconstructed
to include only unambiguous Webflow resources for the selected site. Upstream feature entitlements remain required.

GSAP interactions have explicit read/write/delete grants on both reviewed channels. Create/update also require Custom code write
because upstream IX3 extension bags are open-ended. Mutations require instruction
read and preparation. The router injects the site, checks the envelope page,
verifies existing interaction IDs through paginated site listings, and verifies
page scopes, visibility filters and component/instance targets. Library-owned
scopes and incomplete ownership listings fail closed. Saved grants are not expanded.

### Cloud, campaigns, Optimize and member permissions

New tool families are explicitly classified on both channels; existing saved grants
are retained. Cloud app creation is forced onto the selected site. App,
environment and deployment ownership is checked through site-filtered, fully
paginated resource chains. Deployments and routing-affecting changes require Cloud
Apps Publish; app/environment deletion requires Delete and Publish. Logs and
variable values require a separate Cloud logs & variables Read permission. No raw
response bodies are added to audit events.

Campaign IDs are checked against the selected site; variation/field/suggestion IDs
are verified under that campaign, and personalization is confined to its landing
page. Campaign creation/deletion also requires page and asset grants. Workspace
Campaign Hub discovery is verified against the selected site's live workspace and
reconstructed to include only the selected site. Optimize account discovery is
reconstructed similarly; external sites and ambiguous Optimize IDs fail closed.

Site Access grants operate on one approved site. Workspace Members grants are a
separate, owner-managed map on each connection, defaulting to off and excluded from
project grants and presets. They explicitly authorize workspace-wide member/role
operations, including effects on sibling sites, and are displayed as such in the
management UI. An enabled context project and connection, matching inventory
workspace, live workspace verification, and the selected channel's OAuth grant are
required. Member/invite IDs and explicitly named invite sites are checked against
that workspace. Workspace-grant or mapping changes invalidate preparation proofs
and prevent dispatch/release of in-flight data. These controls preserve project
isolation for all operations without explicit workspace scope.


Beta supports the reviewed GSAP, Cloud Apps, Campaigns, Members and Optimize
operations and Modal schemas. AEO recommendation settings have a separate project
write grant. Under Workspace permissions, two default-off **account-wide** connection
grants allow listing all accessible workspaces and creating standalone Cloud apps.
Standalone creation can create a site, deploy code and set its folder/access mode in
the workspace chosen by Webflow; it requires Custom code write and Cloud Apps publish
on the context project as well as preparation. It does not enable the new project
in the router. Use `data_apps_tool.create_standalone_app` for this path; regular
`create_app` always attaches to the approved project. Existing saved project or
workspace-member permissions never grant these account-wide capabilities.
