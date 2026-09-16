# MCP Router

**Manage MCP connections for Webflow.**

A local desktop app for macOS and Windows by Kvalifik ApS for connecting multiple OAuth grants to your
AI tools and controlling access to individual projects.

MCP Router is independent software. It is not affiliated with, endorsed by,
sponsored by, or approved by Webflow, OpenAI, Anthropic, or the other services
it connects to. Product names identify compatible services only.

## Install on macOS

Choose **mac-arm64** for Apple Silicon (M1 or later), or **mac-x64** for Intel Mac.

1. Open the [GitHub Releases page](https://github.com/Kvalifik/mcp-router/releases) and download the latest
   `MCP-Router-…-mac-arm64.zip` or `MCP-Router-…-mac-x64.zip`. Choose the app ZIP, not GitHub’s “Source code” ZIP.
2. Extract the ZIP and drag **MCP Router.app** into **Applications**.
3. Open MCP Router. This release is **not signed or notarized by Apple**.
   If macOS blocks it, first attempt to open it, then go to
   **System Settings → Privacy & Security → Open Anyway** and confirm opening
   the app. Only do this for a download you trust; don’t disable Gatekeeper.
   Managed company Macs may require IT approval.
4. Choose **Add connection**, authorize Webflow, then enable the projects and
   permissions you want to use. New projects start disabled.
5. Open **Apps**, connect your AI app, and follow its restart/reload instructions.

## Install on Windows

1. Download `MCP-Router-…-windows-x64.zip` from the GitHub Releases page when available.
2. Extract the entire ZIP into a permanent folder, such as `%LOCALAPPDATA%\Programs\MCP Router`.
3. Run **MCP Router.exe**. Keep its supporting files and `resources` folder together.
   This build is unsigned; Windows may display an unknown-publisher warning.
4. Add a connection, authorize Webflow, enable your projects, then connect your AI apps.

Windows support is new and should be smoke-tested before broad distribution. App discovery
covers common per-user and system installations; ChatGPT/Codex detection includes Microsoft Store installations with a bundled
CLI, standalone native CLI installations, and npm CLI installations. For custom installation locations, use the copied MCP configuration.
Quit through the MCP Router menu before replacing the app folder during updates.

### Updating

When a new public GitHub release is available, the app shows **Download update**.
You can also use **Settings → Check for updates**. Downloading opens the release
page; the app does not install updates or restart automatically.

To install an update: finish active work, save any settings, **quit MCP Router**,
and replace the app in Applications with the newly downloaded copy. Reopen it
and reload/restart connected AI apps. Connections and settings stay in the
separate application-data folder. Do not delete that folder when updating.

Update checks use public releases from `Kvalifik/mcp-router`.

## What it does

- Connect multiple Webflow OAuth authorizations without sharing account passwords.
- Discover projects automatically; new projects start disabled.
- Control read, write, delete, and publish actions per project.
- Use read-only, no-publishing, full-access, or custom permission presets.
- Pin frequently used projects and organize connections.
- Configure local MCP clients, including Codex, Claude Desktop, Claude Code,
  Cursor, VS Code, and Gemini CLI.
- Follow system appearance or choose light or dark mode.

The app also includes separately authorized Beta MCP
support. Beta access requires separate authorization and remains subject to
Webflow’s applicable terms and availability.

## Status

Build targets are macOS on Apple Silicon and Intel, and Windows x64. Builds are unsigned;
Mac builds are also unnotarized. See [SECURITY.md](SECURITY.md) for the security model and
known limitations.

## Build and run

Requires Node.js 22 or later and npm. Build Mac releases on macOS and Windows releases on Windows.

```sh
npm ci
npm run build:ui
npm run desktop
```

Run `npm test` for the automated suite and `npm run build:mac` to create
`dist/MCP Router-darwin-arm64/MCP Router.app`.

For Intel Mac, run `BUILD_ARCH=x64 npm run build:desktop`.
For Windows, use PowerShell:

```powershell
$env:BUILD_PLATFORM = "win32"
$env:BUILD_ARCH = "x64"
npm run build:desktop
python scripts/package-release.py
```

On Mac, run `BUILD_ARCH=arm64 python3 scripts/package-release.py` (or `x64`) after building
to validate and create the release ZIP. The release workflow builds all three targets,
runs tests on each host, and combines their checksums before creating an optional draft.

The app stores desktop state in
`~/Library/Application Support/MCPRouter/router/` on Mac and
`%APPDATA%\MCPRouter\router\` on Windows. Existing desktop state is moved automatically from the former directory on
first launch. The bundle identifier is `dk.kvalifik.mcp-router`; AI clients
use `mcp_router_for_webflow`. Legacy client entries are migrated with settings preserved. Running `npm start` directly uses `.local/`
unless `ROUTER_DATA_DIR` is set. Do not run two instances on port 43127.

The desktop app signs into its local dashboard automatically. For `npm start`
browser access, open the single-use URL in `dashboard-login.txt` inside the
state directory. It expires after ten minutes; restart to generate a new link.
Treat that file as private. Direct unauthenticated dashboard requests are denied.

## Set up

1. Open the app and choose **Add connection**.
2. Authorize the intended sites/workspaces with your own Webflow account.
3. Review permissions and enable the projects you want your AI client to access.
4. Choose your client in **Apps**, then restart or reload it as instructed.

A configured checkmark means configuration was saved, not that a running AI
session has loaded it. The **ChatGPT/Codex** entry configures a detected local
Codex MCP client; it does not add a connector to the ChatGPT website.

Moving the installed app changes the executable path. Reconnect each client
after moving or renaming its bundle. Other registrations, project overrides,
and client-specific restrictions remain relevant.

## Permissions and limitations

Router permissions apply only to calls passing through MCP Router. They do not
reduce permissions in Webflow itself or in separate integrations. The app
cannot prevent the same OS user or an agent with local filesystem access from
changing its code or stored settings.

New projects are disabled but initially have all known permissions selected;
review the defaults before enabling them. **No publishing** blocks explicit
publish/unpublish operations. Some writes can affect live settings without a
publish call. A sent write cannot be rolled back by disabling the project.

Each user needs their own provider authorization. OAuth scopes, account roles,
plan limits, and Designer session requirements still apply. Stable and Beta
have separate grants; missing Beta access does not fall back to Stable.

Read the [usage guide](docs/USAGE.md), [privacy notice](PRIVACY.md),
[security policy](SECURITY.md), and [usage terms](TERMS.md).

## License

Source-available under the [MCP Router Source-Available License 1.1](LICENSE).
Business use and paid client work are allowed. You may modify the app and
redistribute meaningfully changed versions for free (see LICENSE section 4a for exceptions). Selling the router, charging for access, and offering
its core functionality as a paid service require separate permission.

This is a custom source-available license, not an OSI-approved open-source
license. The full license controls; see [licensing notes](docs/LICENSING.md).
Third-party components retain their own licenses.

## Contributing and support

See [CONTRIBUTING.md](CONTRIBUTING.md). Contact Kvalifik ApS at
[contact@kvalifik.dk](mailto:contact@kvalifik.dk). Please report security issues
privately rather than attaching credentials or client data to GitHub issues.

[Third-party notices](THIRD_PARTY_NOTICES.md) · [Branding](BRANDING.md)
