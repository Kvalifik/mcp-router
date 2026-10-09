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

Open a connection’s **More options → Reconnect Webflow** to review Stable and Beta
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
Projects slide into their new positions when this order changes, making toggles
and pinning easier to follow. The animation respects reduced-motion preferences.

## Project permissions

Permission toggles and presets remain editable even when Webflow authorization
is missing. They define the user's Router policy; the table does not display
OAuth warnings or lock saved choices off.

Agent tool failures report safe error codes and next steps. Missing Router
permissions identify the settings to enable. Confirmed missing authorization
returns `reauthorization_required`; other access denials and unknown failures
are kept distinct. Provider messages, tokens and request payloads are not echoed.

The agent can call `request_reauthorization` with an enabled project's ID to
obtain a single-use link valid for 60 seconds. Open it on the computer running
MCP Router to start Webflow authorization for that project's selected Stable or
Beta grant. Include this project and other projects that should retain access.
The link does not sign in or approve access for you, and requesting it does not
change the grant. Existing authorization flows are not replaced. Disabled
projects and connections must be enabled in the dashboard first. Enabled
projects that have become unavailable remain discoverable for recovery; their
operations stay blocked. Reauthorization cannot restore a deleted Webflow site.

Router permissions only limit access already granted by Webflow. Editable toggles
do not confirm upstream permission; Webflow may still reject restricted actions.

**Test connection** uses saved settings and requires an enabled connection and Site → Read.
Disabled projects can be tested without enabling them for AI clients. If testing is unavailable, the reason is available in
the button’s tooltip. It tests a read, not write, delete, or publish access. Enabling a project
exposes its allowed actions to connected AI clients; review permissions first.

Use the sliders button next to a project to edit its permissions. The searchable matrix covers 27 areas and 223 pinned Webflow actions: site metadata/publishing, CMS, pages and branches, localization, elements/builders, styles, components/props/variants, variables, assets/fonts, custom code, forms, comments, analytics, webhooks, sitemap, enterprise settings, instructions, and Designer sessions/snapshots/uploads.

Project overview badges show icons for Beta and permission access. Hover or keyboard-focus
an icon to see its label; click it to open project settings. Icons stay beside the
row controls in the compact window.

The **Presets** menu includes icons for All permissions, No publishing, Read & write,
Read only, and No permissions. **Read & write** enables reading and editing while
turning off Delete and Publish permissions. Presets take effect when you save.

- **Read:** inspect data.
- **Write:** create/edit or change the Designer session.
- **Delete:** explicit removal operations.
- **Publish:** explicit publish/unpublish actions, including branches and CMS items.
- A dash means Webflow currently exposes no action in that category.
- Existing projects retain their previous permissions and enabled state. Newly discovered projects appear automatically, disabled, with all current permissions selected by default.
- **Defaults** sets the initial permissions. Changes apply to newly discovered projects and disabled projects still using defaults. Once enabled or explicitly customized, a project keeps its own permissions.
- Connections expand to show their projects; global search opens matching groups. Enabled projects are listed first. **More options → Sync projects** refreshes project availability for enabled, connected connections; projects cannot be deleted locally. Previously trashed projects return disabled when available.
- Projects follow their Webflow names until locally renamed. **Use default name** removes an override. Connections use a provider workspace name when available; otherwise their local label is retained and no Webflow default is claimed. Labels can always be overwritten.
- All changes also require **Instructions → Read** so the agent can load project rules before writing.
- Canvas editing/building also requires **Custom code → Write**, since element content and settings can contain executable code. The operation catalog reports these extra permission requirements.
- These categories govern MCP actions. Editing operations can replace values or affect live settings without a separate publish call. Delete does not mean every edit is reversible, and disabling Publish does not make all writes draft-only.
- Webflow OAuth grants, account roles, paid-plan restrictions, and active Designer/MCP Bridge requirements still apply. The router cannot provide functionality absent from Webflow's MCP server.

Project search covers both local and original site names. Rename changes local labels. Project settings contain rename, permissions and a test of saved read access. Deleting a connection permanently removes its local credentials and project settings; it does not delete Webflow sites. Existing trashed connections are purged on upgrade.

## Codex tools

The MCP connection advertises its tools immediately, without waiting for the
router daemon or Webflow metadata during initialization or tool listing. This
keeps slow or unavailable upstream connections from blocking tool discovery.
Webflow's current server instructions and original tool descriptions are fetched
on demand for the selected project through the guidance/preparation calls below.
Metadata requires **Instructions → Read** and uses that project's selected Stable
or Beta grant. Only tools with permitted, reviewed operations are described;
upstream descriptions do not grant access to additional actions.

`get_project_guidance` fetches the current server instructions, guide and tool
descriptions. `prepare_project` also returns this metadata along with enabled site
rules and skills. Clients supporting MCP resources can discover and read
`webflow-router://projects/{projectId}/guidance` to load the same preparation.
The router does not expose arbitrary upstream resources: project rules are read
through the existing site-scoped instruction checks. Guidance is not persisted or
reused from a failed grant, and metadata failures never switch Stable/Beta grants.

Webflow guidance updates take effect on the next preparation or guidance request;
router workflow instructions refresh on reconnect. An AI app may cache tool lists and may
need a reconnect to display changed descriptions. Content already loaded into a
conversation cannot be withdrawn by revoking access, but subsequent requests are
checked again. Actual tool selection still depends on the AI app and model.
Agents are instructed to load project rules before reads as well as writes; only
writes enforce a preparation ID.
For clients with standing agent instructions, add: “For Webflow tasks, discover
MCP Router for Webflow before declaring tools unavailable. Use `list_projects`,
then `prepare_project` to load project rules. Missing direct Webflow tools is not
evidence that reconnection is needed. Recommend reauthorization only when a tool
reports `reauthorization_required`.” If router tools are genuinely absent from the
client, check its MCP registration and reload the connection; changing Webflow
OAuth grants does not make missing client tools appear.

- `list_projects`: enabled projects and their effective permission keys. Supply `query` to search names (case-insensitive substring, 1–80 characters). Searches also return up to 20 matching disabled project names with a disabled status and instructions to enable them; narrow the query if the limit is reached. Disabled matches include no IDs, permissions, or project content. The default list remains enabled-only.
- `read_project_site`: compatible site-metadata read.
- `get_project_operations`: permitted action IDs; pass `operationId` to retrieve its exact JSON parameter schema.
- `get_project_guidance`: live Webflow server instructions, guide and original descriptions of tools with permitted operations.
- `prepare_project`: Webflow guide plus enabled project rules/skills and a ten-minute preparation ID. Agents must read and follow the returned instructions before writing.
- `read_webflow`: execute one permitted read operation.
- `write_webflow`: execute one permitted write/delete/publish operation with its preparation ID.

**Settings → Let AI discover disabled project names** is on by default, including for existing installations. Turn it off to hide disabled projects from AI name searches. Projects under disabled connections, deleted projects, and projects marked unavailable are always hidden. Discovery uses the saved inventory, grants no access, and does not enable projects.

Both execution tools accept `projectId`, `operationId`, `params`, and (where required) `pageId`. The router injects the selected site's ID. Collection/page/asset/folder/form/webhook IDs are checked against site-scoped discovery before dispatch. Unknown actions and malformed payloads fail closed. Calls serialize per OAuth connection. Policies are checked before dispatch and before releasing responses. A write already sent to Webflow cannot be rolled back by revoking a permission; do not automatically retry ambiguous write failures.

When a requested action lacks router permissions, the error names the missing settings (for example, **Custom code → Write**) and tells the agent to ask you to enable them using the project's sliders button and save. Preparation and guidance similarly identify missing **Instructions → Read** access. Action listings still show only permitted operations. Calling an action through the wrong execution tool identifies the correct tool. Upstream failures remain sanitized because provider errors may contain sensitive content; they do not reliably identify missing Webflow access.

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

Settings → Default MCP version sets the global default. A connection's Reconnect Webflow
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

On macOS, ChatGPT/Codex detection supports both current and legacy bundled CLI locations, with a standalone `codex` executable as a fallback.

Microsoft Store installations of ChatGPT/Codex are detected for the current Windows user. Connecting updates the shared Codex `config.toml` (`CODEX_HOME` when set, otherwise `~/.codex`) without launching protected Store executables. Existing comments, other servers, and tool restrictions are preserved; an existing configuration is backed up before changes.

### Checking for updates

Use **Settings → Check for updates** to check the latest public GitHub release.
The desktop app also checks on startup and every six hours while it is open.

Developer ID Mac builds download newer signed releases automatically when the
release includes an update feed for your Mac's architecture. Electron verifies
the update's signature before installation. A persistent notification offers
**Restart to update**; otherwise the downloaded update installs when you quit.
Restarting briefly disconnects active AI clients. Closing the window only hides
the app and does not install the update. Connections and settings remain saved.

Windows, development builds, and releases without a compatible update feed use
**Download update**, which opens GitHub Releases for manual installation. Existing
versions without updater support need one manual install of a signed version
that includes it. Install the Mac app in Applications before using auto-updates.

If checking or downloading fails, the app shows a safe error message and does not
install an unverified update. Check again to retry, or use GitHub Releases. If a
download times out but remains pending, restart the app before retrying.

### macOS menu bar

Choose **Settings → Menu bar → Icon only**, **Connections**, **Projects**, or **Connections and
projects** to choose the menu bar display. By default, the app icon and project
count are shown. Your choice, including **Off**, is saved across restarts; existing
preferences are preserved. Icon only shows no count. A single count shows
the selected total; both shows connections/projects (for example, `2/7`).
Connections counts enabled connections with at least one ready authorization;
Projects counts enabled, available projects with permissions and
a ready authorization for their selected Stable or Beta version. These are
configured access counts, not live AI sessions. Enabled switches preserve your
selection even when access is not ready. Healthy views show ordinary counts with
no readiness banner or extra status text. Disabled connections do not create warnings.
Counts update when router state is saved, without a polling timer.

When access needs attention, the menu bar icon gains a warning triangle (including
in Icon only mode). Its tooltip then shows how many enabled projects are ready,
names the affected projects or connections, and explains the next action. The
normal tooltip uses plain connection and project counts. Pending checks are
informational, with no warning triangle or “X of X” count.

A small circular warning badge appears on the affected connection, including when
collapsed. In its project row, the warning replaces the normal access badge; row
height stays the same and the Beta badge continues to identify the selected version.
Hover or focus the warning to read the reason, then click or press Enter to review
and fix it. Connection details include affected projects hidden by search or pin
filters. **Settings → Review access issues** lists every current issue.

Details offer authorization for the selected Stable or Beta version, a retry for
failed checks, or permission settings. These actions never switch versions
automatically. After recovery the badges disappear. Pending checks use a neutral
spinner badge with details available in the same way.

Click the item to open the same interface in a compact, responsive window,
including while another app is fullscreen. Search,
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
