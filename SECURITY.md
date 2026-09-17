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
  separate.
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
