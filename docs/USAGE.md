# Usage and architecture

## Authorizing a connection

**Add connection** explains access before opening Webflow. Select the projects
you want to manage and allow the requested permissions for the full feature set,
then use router permissions to limit AI access. Narrower authorization is supported;
the router cannot grant access that Webflow did not authorize. New projects start
disabled, with default permissions selected. Review them before enabling projects.

Open a connection’s **More options → MCP server** to review Stable and Beta
authorization separately and compare their authorized project inventories.
When reconnecting, include all projects that should retain access. The router cannot
inspect the full Webflow permission grant. Its restrictions apply only to calls
passing through MCP Router; Webflow still enforces its own access restrictions.

## Automatic project resync

While the router is running, it checks once a minute for project inventories whose
last successful sync is at least an hour old, including at startup. Enabled,
authorized Stable and Beta grants sync independently. Manual resync remains available.
Busy connections and pending browser authorizations are skipped until a later check.
Failures retry after 5, 10, 20, 40 minutes and progressively longer delays, capped
at six hours. Retry delays reset on restart or a successful sync.

Resync reads project summaries, not pages, CMS content, or assets. New projects
remain disabled; existing permissions and local names are preserved. Projects
absent from the combined successful Stable/Beta inventory become unavailable and
disabled. Failed requests retain the previous inventory.

## Project permissions

Permission toggles are locked while the selected Stable or Beta authorization is
missing, project access is still being checked, or the project is not authorized
on that server. Hover or keyboard-focus a locked toggle to see why. Presets leave
locked preferences unchanged, and saved choices return when access is restored.
Default permissions remain editable because they are a template for future projects.

Router permissions only limit access already granted by Webflow. Editable toggles
do not confirm upstream permission; Webflow may still reject restricted actions.

**Test connection** uses saved settings and requires an enabled project, an enabled
connection, and Site → Read. If testing is unavailable, the reason appears above
the button. It tests a read, not write, delete, or publish access. Enabling a project
exposes its allowed actions to connected AI clients; review permissions first.

Use the sliders button next to a project to edit its permissions. The searchable matrix covers 27 areas and 223 pinned Webflow actions: site metadata/publishing, CMS, pages and branches, localization, elements/builders, styles, components/props/variants, variables, assets/fonts, custom code, forms, comments, analytics, webhooks, sitemap, enterprise settings, instructions, and Designer sessions/snapshots/uploads.

- **Read:** inspect data.
- **Write:** create/edit or change the Designer session.
- **Delete:** explicit removal operations.
- **Publish:** explicit publish/unpublish actions, including branches and CMS items.
- A dash means Webflow currently exposes no action in that category.
- Existing projects retain their previous permissions and enabled state. Newly discovered projects appear automatically, disabled, with all current permissions selected by default.
- **Defaults** sets the initial permissions. Changes apply to newly discovered projects and disabled projects still using defaults. Once enabled or explicitly customized, a project keeps its own permissions.
- Connections expand to show their projects; global search opens matching groups. Enabled projects are listed first. Sync manages project availability automatically; projects cannot be deleted locally. Previously trashed projects return disabled when available.
- Projects follow their Webflow names until locally renamed. **Use default name** removes an override. Connections use a provider workspace name when available; otherwise their local label is retained and no Webflow default is claimed. Labels can always be overwritten.
- All changes also require **Instructions → Read** so the agent can load project rules before writing.
- Canvas editing/building also requires **Custom code → Write**, since element content and settings can contain executable code. The operation catalog reports these extra permission requirements.
- These categories govern MCP actions. Editing operations can replace values or affect live settings without a separate publish call. Delete does not mean every edit is reversible, and disabling Publish does not make all writes draft-only.
- Webflow OAuth grants, account roles, paid-plan restrictions, and active Designer/MCP Bridge requirements still apply. The router cannot provide functionality absent from Webflow's MCP server.

Project search covers both local and original site names. Rename changes local labels. Project settings contain rename, permissions and a test of saved read access. Deleting a connection permanently removes its local credentials and project settings; it does not delete Webflow sites. Existing trashed connections are purged on upgrade.

## Codex tools

- `list_projects`: enabled projects and their effective permission keys.
- `read_project_site`: compatible site-metadata read.
- `get_project_operations`: permitted action IDs; pass `operationId` to retrieve its exact JSON parameter schema.
- `prepare_project`: Webflow guide plus enabled project rules/skills and a ten-minute preparation ID. Agents must read and follow the returned instructions before writing.
- `read_webflow`: execute one permitted read operation.
- `write_webflow`: execute one permitted write/delete/publish operation with its preparation ID.

Both execution tools accept `projectId`, `operationId`, `params`, and (where required) `pageId`. The router injects the selected site's ID. Collection/page/asset/folder/form/webhook IDs are checked against site-scoped discovery before dispatch. Unknown actions and malformed payloads fail closed. Calls serialize per OAuth connection. Policies are checked before dispatch and before releasing responses. A write already sent to Webflow cannot be rolled back by revoking a permission; do not automatically retry ambiguous write failures.

The action catalog is a pinned snapshot of Webflow's `tools/list` schema. Future provider actions are not automatically granted. Utility tools that ask Webflow AI or submit capability requests are not proxied; site discovery remains local-owner-only. Asset/font uploads return Webflow's presigned upload details; transferring file bytes is a separate operation. Enterprise actions and Designer-only operations cannot be live-tested on sites without the corresponding plan/session.

## Local trust boundary

OAuth registrations and tokens remain in the daemon under `~/Library/Application Support/MCPRouter/router/`. AES-256-GCM encrypted state uses a local `0600` key and a `0700` directory. This is not an OS-keychain-backed production vault: the same OS user can decrypt or change it. On Mac the Unix socket is restricted to the local OS user. On Windows, state is stored in `%APPDATA%\MCPRouter\router\` under a protected current-user ACL, and the named pipe requires a random token read from that private directory. Codex receives no OAuth tokens.

The management UI binds to `127.0.0.1`, requires an owner-only session, validates Host/Origin, and requires CSRF headers for changes. The Electron renderer is sandboxed with context isolation. OAuth uses PKCE, independently registered clients, and browser-bound one-use state. Tokens are only sent to Webflow's MCP host.

Permissions apply only to this router. Other Webflow connections and an agent able to alter local source/state are outside this boundary. This is a local tool, not a shared multi-user authorization service.

## Development notes

```sh
npm ci
npm run build:ui
npm run desktop
npm test
npm run build:mac
```

Source mode uses `.local/`; never run it alongside the installed app on the same port. Bundles exclude private state and tests. `scripts/build-catalog.py` generates the pinned action catalog from an explicitly reviewed tools/list snapshot; classification and ownership checks must be reviewed when refreshing it.


## Stable and Beta

Settings → Default MCP server sets the global default. A connection's MCP server
menu authorizes Stable and Beta independently. Projects can follow the default
or explicitly select Stable or Beta. Beta grants must include the selected
project; grant mismatches are reported. Beta use remains subject to provider
terms.

## Organization

Pins mark frequently used projects without enabling them. Use the Pinned filter
next to search. Reorder connections from Settings using drag handles or arrows.

### Set up another AI app with an agent

Choose **Apps → Copy configuration → Agent setup snippet** and paste it into
your chosen agent. The snippet includes this installation’s local stdio connection
details and asks the agent to adapt them to its app while preserving existing
settings and restrictions. Keep MCP Router running, then follow any reload or trust
steps the agent provides. Copying the snippet does not connect the app by itself.

On Windows, the app header includes the native minimize, maximize, and close controls. Drag the header to move the window; press Alt to reveal the application menu when needed.

Microsoft Store installations of ChatGPT/Codex are detected for the current Windows user. Connecting updates the shared Codex `config.toml` (`CODEX_HOME` when set, otherwise `~/.codex`) without launching protected Store executables. Existing comments, other servers, and tool restrictions are preserved; an existing configuration is backed up before changes.
