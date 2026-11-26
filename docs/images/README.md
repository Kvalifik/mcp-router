# README screenshots

These screenshots render the current React UI with fictional connections and
projects. They contain no customer data and do not use saved router state.

From the repository root, after `npm ci`, run on macOS:

```sh
npx electron scripts/capture-readme.mjs
```

The script starts a temporary Vite server on an available loopback port, supplies
read-only demo API data, and captures the overview and project permissions dialog
in Electron. It uses an isolated temporary profile and blocks external requests.
The demo desktop bridge supports native dropdown menus and opening the main
window from the menu bar panel. The GitHub repository and feedback links open
their fixed public destinations in the default browser. External account and
integration actions use fixtures isolated from real grants and client settings.
The script briefly shows an 860 × 640 demo window and uses macOS
`screencapture` to include native window controls and the window shadow. Screen
Recording permission may be required. Two demo projects use authorized Beta
access. The README displays both Retina captures at a maximum width of 720 pixels.

Run Electron with desktop access from the start. In a restricted agent execution
sandbox, request an approved unsandboxed launch rather than trying a sandboxed
launch first: an Electron startup abort can trigger macOS's “quit unexpectedly”
dialog before this script can handle it. Do not disable Chromium's own sandbox.
Successful captures close the Vite server and use `app.quit()` for normal window
shutdown, then remove the temporary profile on the `quit` event. Do not kill the
capture process or remove its profile while Chromium is still using it.

The capture retries fully transparent window images up to three times and fails
if macOS still returns a blank capture. Review both PNGs after regenerating them, especially when layout or permission
groups change. Demo names and presets live in `scripts/capture-readme.mjs`.
The overview represents a user who has already set up Claude Desktop. Its
registration lives in the temporary demo profile.

Run `npx electron scripts/capture-readme.mjs --verify-app-setup` to exercise
first-project setup, choosing a single app or one of several, retrying after a
configuration error, dismissing the prompt, and finding restart instructions
after reopening the window. This mode uses fictional app installations and
leaves the README screenshots in place.

For a hands-on walkthrough, run `npm run demo -- --app-setup`. In **Example
Studio**, enable **Juniper & Kite**, choose **Choose an AI app**, and select
one of the seven fictional installations. The prompt collapses and **Apps (0/7)**
changes to **Apps (1/7)**. Open **Apps (1/7)** and select that app to
see its saved setup status and next step. Close the window and run the command
again to reset. To demonstrate the single-app button, use
`npm run demo -- --app-setup=cursor`.

The header graph uses fictional routed calls. For activity interaction checks, run
`npx electron scripts/capture-readme.mjs --verify-activity`. This checks header
alignment of dialog controls and toolbar buttons, equal-width bars, stable heights and
time intervals for a four-call burst, centered idle dots,
chevron padding, switch colors, opening Activity directly from either toolbar,
each time range’s totals and sources, animated and reduced-motion range changes,
the toolbar’s in-progress cue and stable width, selecting and clearing an interval by
pointer or keyboard, toolbar access above dialogs, primary button colors and
translucent borders, chart bars, scroll boundaries, and scrolling to the
weekly calendar. It also checks which fonts rendered in each window. It writes
light and dark review captures of the renderer under the system temporary
directory, including the overview and permissions dialog. These can be used for
review while the Mac is locked. The README uses the native window captures.

For a screen recording, run `npm run demo`. This opens the same isolated,
fictional demo with both connections expanded and simulated traffic flowing, and keeps it open until you close
the window. Changes to toggles, names, pinning, permissions, defaults, ordering,
and connection deletion are saved in memory for that run. Adding or reconnecting
a connection simulates authorization and supplies fictional projects; sync and
connection tests are simulated too. Nothing contacts Webflow or changes real
accounts, and restarting the demo resets the data. Recording mode does not capture or replace the
README screenshots.
On macOS, recording mode also includes the menu bar icon and project count.
Click it to open the compact project panel, or right-click to reopen the main
demo window or quit.

The menu bar panel’s expand button opens the main demo window. Native dropdowns
use the same validated menu templates and bundled icons as the app, and keep the
panel open while a menu is active. The panel itself does not enter full screen.

To preview access warnings with fictional data, run
`npx electron scripts/capture-readme.mjs --attention`. This also captures the
healthy compact window and warning states (collapsed, expanded, tooltip, and
recovery details) in `/tmp/mcp-router-*.png`; these previews are not README assets.
It checks that connection and project warning badges align, warnings do not increase row height, keyboard access and focus
return work, filtered projects remain reachable, and simulated Beta recovery
clears warnings without changing the Stable grant. All actions use in-memory demo
state, including in this preview mode.

For the same interaction checks without replacing screenshots, use
`npx electron scripts/capture-readme.mjs --verify-attention`.
This also verifies the connection menu's Connection permissions dialog, its
default-off state and scope explanation, and saving without changing project grants.
The Direct check covers individual sites with no workspace metadata and update
notifications beneath the toolbar while About is open. It also exercises the
Kvalifik link, Apps, Settings, Activity and compact expand button during an
unsaved edit. It checks that closing a second dialog restores the edit in the
desktop app and that the browser Settings menu works with a dialog open.
Both checks verify that only the Beta badge shows its tooltip and that the switch remains accessible to pointer and keyboard users.

The attention verification also exercises connection access modes: Managed is the
default, Direct shows its authorization-wide scope before saving, project controls
become inactive, and switching back preserves all saved project settings.
`--attention` saves temporary Direct dialog and overview previews under
`/tmp/mcp-router-direct-*.png`; these do not add README assets.

For focused Direct-mode UI verification, run
`npx electron scripts/capture-readme.mjs --verify-direct`. It checks the native menu,
mode round-trip and compact dialog scrolling, saves temporary previews under
`/tmp/mcp-router-direct-*.png`, and leaves README screenshots unchanged.
