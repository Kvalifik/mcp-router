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
The desktop bridge is stubbed; no OAuth grants or client configurations are read
or changed. The script briefly shows an 860 × 640 demo window and uses macOS
`screencapture` to include native window controls and the window shadow. Screen
Recording permission may be required. Two demo projects use authorized Beta
access. The README displays both Retina captures at a maximum width of 720 pixels.

Review both PNGs after regenerating them, especially when layout or permission
groups change. Demo names and presets live in `scripts/capture-readme.mjs`.
