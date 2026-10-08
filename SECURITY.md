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
