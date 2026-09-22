# MCP Router icon assets

Approved AI hub design: a white AI spark between two arch branches and two rounded workspace nodes, on a cobalt-blue rounded square. Blue gaps separate all five parts. Redrawn as vector artwork from the selected concept; no generated raster is embedded in the masters.

## Deliverables

- `app-icon.svg`: scalable colour master, 1024 × 1024 canvas. Transparent 64px outer margin; blue tile spans 896px. Keep this margin when using the app icon in the Dock.
- `MCPRouter.icns`: macOS application icon, already referenced by `build.mjs`.
- `MCPRouter.iconset/`: standard macOS 1× / 2× source PNGs.
- `png/`: transparent RGBA app icons at 16, 24, 32, 48, 64, 128, 256, 512 and 1024px.
- `mark.svg`: standalone transparent vector mark using `currentColor` (black by default).
- `mark-black.svg`, `mark-white.svg`: fixed-colour vector marks.
- `mark-black.png`, `mark-white.png`: transparent 1024px monochrome exports.
- `menubar/MCPRouterTemplate.png`, `@2x.png`, `@3x.png`: 22pt macOS template assets with an 18pt black mark and transparent padding. Use as a template image so macOS supplies the appropriate tint. Assets only; no new menu-bar feature has been added.

## Rebuild

Exports are committed assets; the normal app build does not need an icon-rendering dependency. To regenerate on macOS, make `sharp` available to Node (installed locally or through NODE_PATH), then run:

    node scripts/build-icons.cjs

The script renders the SVGs through sharp and creates the ICNS using macOS `iconutil`.

## Styling

Background gradient: #079AFF → #0566EF → #0638BD. Mark: #FFFFFF. Use the monochrome variants for small interface controls; do not add a second tile behind the coloured app icon. The SVG sources are the editing masters.

Native Settings menu icons in `menu/` use the same Lucide shapes as the web UI.
Regenerate them with `npx electron scripts/build-menu-icons.cjs`. The PNGs are
32px assets used at 16pt (2x) and marked as macOS template images at runtime.
