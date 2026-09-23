# Usage and architecture

MCP Router brings projects from multiple Webflow workspaces into one MCP
connection for your AI tools. Add the Webflow authorizations you need, then
enable the projects and permissions you want available at the same time.

## Authorizing a connection

After a new connection successfully discovers its projects, MCP Router asks for a
local connection name. For a single-project connection, it suggests the project
name. Save a name or keep the current label. This prompt is shared by Stable and
Beta and does not repeat when adding the other server or reconnecting. Existing
connections are not prompted.

**Add connection** explains access before opening Webflow. Select the projects
you want to manage and allow the requested permissions for the full feature set,
then use router permissions to limit AI access. Narrower authorization is supported;
the router cannot grant access that Webflow did not authorize. New projects start
disabled, with default permissions selected. Review them before enabling projects.

Open a connection’s **More options → Connection access** to review Stable and Beta
authorization separately and compare their authorized project inventories.
You can authorize or reconnect while the connection is off. Authorization refreshes
its project inventory without enabling the connection or granting AI access.
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

## Project order

Pinned projects appear first within each connection, in alphabetical order. Turning
a pinned project on or off does not change its position. Unpinned projects appear
below them, with enabled projects first, then alphabetically within each group.

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

The MCP connection forwards Webflow's current server instructions at startup and
adds Webflow's original tool names, titles and descriptions to operation discovery
each time an AI client requests its tool list. Metadata is fetched from each enabled
project's selected Stable or Beta grant and requires **Instructions → Read**.
Only tools with at least one permitted, reviewed operation are described, alongside
their allowed operation IDs. A tool's upstream description may mention additional
actions; that description does not grant access to them.

`get_project_guidance` fetches the current server instructions, guide and tool
descriptions. `prepare_project` also returns this metadata along with enabled site
rules and skills. Clients supporting MCP resources can discover and read
`webflow-router://projects/{projectId}/guidance` to load the same preparation.
The router does not expose arbitrary upstream resources: project rules are read
through the existing site-scoped instruction checks. Guidance is not persisted or
reused from a failed grant, and metadata failures never switch Stable/Beta grants.

Webflow guidance updates take effect on the next discovery or guidance request;
startup instructions refresh on reconnect. An AI app may cache tool lists and may
need a reconnect to display changed descriptions. Content already loaded into a
conversation cannot be withdrawn by revoking access, but subsequent requests are
checked again. Actual tool selection still depends on the AI app and model.
Agents are instructed to load project rules before reads as well as writes; only
writes enforce a preparation ID.
If an agent still misses it, say: “Use MCP Router to find this Webflow project and
load its project instructions before proceeding.”

- `list_projects`: enabled projects and their effective permission keys.
- `read_project_site`: compatible site-metadata read.
- `get_project_operations`: permitted action IDs; pass `operationId` to retrieve its exact JSON parameter schema.
- `get_project_guidance`: live Webflow server instructions, guide and original descriptions of tools with permitted operations.
- `prepare_project`: Webflow guide plus enabled project rules/skills and a ten-minute preparation ID. Agents must read and follow the returned instructions before writing.
- `read_webflow`: execute one permitted read operation.
- `write_webflow`: execute one permitted write/delete/publish operation with its preparation ID.

Both execution tools accept `projectId`, `operationId`, `params`, and (where required) `pageId`. The router injects the selected site's ID. Collection/page/asset/folder/form/webhook IDs are checked against site-scoped discovery before dispatch. Unknown actions and malformed payloads fail closed. Calls serialize per OAuth connection. Policies are checked before dispatch and before releasing responses. A write already sent to Webflow cannot be rolled back by revoking a permission; do not automatically retry ambiguous write failures.

The execution catalog remains a pinned snapshot of Webflow's `tools/list` schema;
live guidance does not replace its reviewed parameter schemas, ownership checks or
permission classifications. Future provider actions and schema changes are not
automatically granted. Utility tools that ask Webflow AI or submit capability
requests are not proxied; site discovery remains local-owner-only. Optional skills
installed in an AI app are separate from MCP and are not installed by the router.
Asset/font uploads return Webflow's presigned upload details; transferring file
bytes is a separate operation. Enterprise actions and Designer-only operations
cannot be live-tested on sites without the corresponding plan/session.

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

Settings → Default MCP version sets the global default. A connection's Connection access
menu shows Stable and Beta authorization separately, with explicit actions to
authorize or reconnect each version. In project settings, **MCP version**
offers **Default (Currently Stable)** or **Default (Currently Beta)** to follow
the default, or **Stable** and **Beta** to explicitly override it. Beta grants must include the selected
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

### Checking for updates

Use **Settings → Check for updates** to check the latest public GitHub release.
If a check fails, the message distinguishes connection failures, timeouts, GitHub
rate limits, and invalid responses when that information is available. Updates
are downloaded manually from the release page when a newer version is found.
The update-available notification stays visible until you dismiss it or select
**Download update**.

### macOS menu bar

Choose **Settings → Menu bar → Icon only**, **Connections**, **Projects**, or **Connections and
projects** to choose the menu bar display. By default, the app icon and project
count are shown. Your choice, including **Off**, is saved across restarts; existing
preferences are preserved. Icon only shows no count. A single count shows
the selected total; both shows connections/projects (for example, `2/7`).
Connections counts enabled connections with at least one ready authorization;
Projects counts enabled, available projects with permissions and
a ready authorization for their selected Stable or Beta version. These are
configured access counts, not live AI sessions. Counts update when router state
is saved, without a polling timer. Hover over the icon for labeled
counts and an indication when access needs attention.

Click the item to open the same interface in a compact, responsive window. Search,
pinning, access switches, and settings use the same controls as the main window.
Settings, Add connection, Apps, and Open main window appear as equally sized
icons in the compact header. The expand icon opens the full window.
Desktop dropdowns use native menus with icons throughout the app: Settings,
Apps, connection actions, project MCP version, and permission presets. Submenus
can extend outside the window. Browser dashboards use the same options in web
dropdowns. Native selections still use the existing authorization, permission,
and deletion-confirmation flows. Clicking outside or pressing Escape dismisses
the popover. Right-click the menu bar item to open the app or quit. Closing the
main window keeps the router running; quitting stops it.

In the Apps menu, a checkmark identifies an app that is already set up. Each
installed app opens a submenu with a non-clickable setup status and a separate
Set up or Reconnect action. An exclamation mark indicates a configuration that
needs reconnecting; unconfigured apps have no status icon. The Not installed
submenu lists supported apps absent from this computer. Setup status describes the saved configuration,
not whether the app is running.
