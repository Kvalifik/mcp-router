# MCP Router icon assets

Brand artwork: a dark outlined AI spark above two curved branches and two outlined workspace nodes, on a lavender gradient rounded square. The supplied vector artwork is preserved in the colour master; no raster images are embedded.

## Deliverables

- `app-icon.svg`: scalable colour master, 1024 × 1024 canvas. Transparent approximately 64px outer margin; lavender tile spans approximately 896px. Keep this margin when using the app icon in the Dock.
- `MCPRouter.icns`: macOS application icon, already referenced by `build.mjs`.
- `MCPRouter.ico`: Windows application icon, already referenced by `build.mjs`, with 16, 24, 32, 48, 64, 128 and 256px RGBA images.
- `MCPRouter.iconset/`: standard macOS 1× / 2× source PNGs.
- `png/`: transparent RGBA app icons at 16, 24, 32, 48, 64, 128, 256, 512 and 1024px.
- `mark.svg`: standalone transparent vector mark using `currentColor` (black by default), cropped to a 624 × 624 canvas around the original artwork.
- `mark-black.svg`, `mark-white.svg`: fixed-colour vector marks.
- `mark-black.png`, `mark-white.png`: transparent 1024px monochrome exports.
- `mark-menubar.svg`: optically strengthened menu-bar master, with approximately 1.2pt outlines and a 1pt gap between branches and workspace nodes at its 18pt display size. Used by normal, warning and update templates; the app icon and general-purpose monochrome marks retain their original weights.
- `menubar/MCPRouterTemplate.png`, `@2x.png`, `@3x.png`: 22pt macOS template assets with an 18pt black mark and transparent padding. Use as a template image so macOS supplies the appropriate tint.

- `menubar/MCPRouterWarningTemplate.png`, `@2x.png`, `@3x.png`: 25 × 24pt warning variant, with a transparent mask separating the triangle from the router mark. Rendered from the vector composition in `scripts/build-tray-warning.cjs`.

- `menubar/MCPRouterUpdateTemplate.png`, `@2x.png`, `@3x.png`: 25 × 24pt update-ready variant, with a transparent mask separating the circled arrow from the router mark. Rendered from `scripts/build-tray-update.cjs`.

## Rebuild

Exports are committed assets; the normal app build does not need an icon-rendering dependency. To regenerate on macOS, make `sharp` available to Node (installed locally or through NODE_PATH), then run:

    node scripts/build-icons.cjs
    npx electron scripts/build-tray-warning.cjs
    npx electron scripts/build-tray-update.cjs

Run all three commands when changing the mark. The first renders the SVGs through sharp, creates the ICNS using macOS `iconutil`, and packages the Windows ICO. The two Electron commands render the status variants at 1×, 2× and 3× with Chromium. Electron requires desktop access; retain its sandbox when launching from a restricted agent environment.

The monochrome SVG masters reuse the colour master's paths and spark mask, remove the background tile and gradient, and normalize the artwork to black, white or `currentColor`. Keep the mask white in every variant so the outlined spark remains visible. Keep the path geometry synchronized when replacing the colour master. Review small app icons and all three menu-bar states on light and dark backgrounds after rebuilding.

## Styling

Background gradient: #CFBFF3 → #9B89C4. Spark and branches: #000000. Workspace nodes: #1E1E1E. Use the monochrome variants for small interface controls; do not add a second tile behind the coloured app icon. Preserve the supplied outline weights and shapes in the app icon and general-purpose marks. The dedicated menu-bar master uses heavier outlines for legibility at small sizes. The SVG sources are the editing masters.

Native Settings menu icons in `menu/` use the same Lucide shapes as the web UI.
Regenerate them with `npx electron scripts/build-menu-icons.cjs`. The PNGs are
32px assets used at 16pt (2x) and marked as macOS template images at runtime.
