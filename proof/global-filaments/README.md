# Reproduce the global filament flow

The sample uses published `@printhive/api@0.4.1` with an owned loopback API fixture. The metadata-only project is [shared.3mf](../material-mapping/shared.3mf). No production API, real printer, production credential, user design, or port 3077 is involved.

Review the [desktop recording](desktop.mp4) or [mobile recording](mobile.mp4). They show a global catalog filament copied to two selected plates, ID-only previews, and separate requests held for manual review. The CSS viewports are 1280 by 900 and 390 by 844. Both exported videos received complete playback and visual review before publication.

## Reproduce the flow

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `DEMO_PROJECT=shared DEMO_PORT=3086 node proof/general-sample/serve.mjs`.
4. Open `http://127.0.0.1:3086`.
5. Upload `proof/material-mapping/shared.3mf`.
6. Include plates 2 and 7.
7. Search `black PETG` and select **Use Generic PETG-CF**.
8. Apply the choice to the selected matching plates.
9. Confirm usage on both plates.
10. Preview both global catalog IDs and submit with manual release.
11. Check the held request for each plate.

To rehearse with Playwright, run `node proof/global-filaments/record.mjs --rehearse`. To capture both desktop and mobile viewports, run the same command without `--rehearse`. Set `PLAYWRIGHT_PACKAGE` to an installed Playwright package path if it is outside this repo.

Set `DEMO_GLOBALS=disabled` when starting the fixture to exclude global rows. The fixture also includes an ineligible global row without a color. It never accepts that row during creation.

This fixture proves the UI and SDK protocol. It does not prove live catalog relevance, organization policy configuration, real slicing, or physical printing. Automated SDK tests separately cover disabled globals, creation errors, and unchanged retries.
