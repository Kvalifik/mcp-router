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
window from the menu bar panel; external account and integration actions remain simulated; no OAuth grants or client configurations are read
or changed. The script briefly shows an 860 × 640 demo window and uses macOS
`screencapture` to include native window controls and the window shadow. Screen
Recording permission may be required. Two demo projects use authorized Beta
access. The README displays both Retina captures at a maximum width of 720 pixels.

Review both PNGs after regenerating them, especially when layout or permission
groups change. Demo names and presets live in `scripts/capture-readme.mjs`.

For a screen recording, run `npm run demo`. This opens the same isolated,
fictional demo with both connections expanded and keeps it open until you close
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
