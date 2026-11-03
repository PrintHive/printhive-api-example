# Historical plate-selection verification

These recordings document the first multi-plate implementation with SDK 0.3.2. The [material mapping verification](../material-mapping/README.md) covers the current shared assignment and SDK 0.4.0 flow.

[Desktop recording](desktop.mp4) and [mobile recording](mobile.mp4) show the built React app, Node backend, and published SDK 0.3.2 against an owned loopback HTTP fixture. The CSS viewports are 1280 by 900 and 390 by 844. The exported recordings received full playback and visual review before publication.

Both paths cover these states:

- The bundled cube has no saved preview and remains selectable.
- A synthetic project supplies distinct PNGs for sparse plate numbers 2 and 7.
- Selecting both cards preserves independent source confirmations and catalog mappings.
- Removing and restoring a selected plate retains its mapping. Opening an excluded plate for editing leaves its inclusion checkbox unchecked.
- One multipart submission creates two requests with distinct per-plate requirements.
- Releasing plate 2 and cancelling plate 7 target separate request IDs. Status polling follows both plates.

The saved images are synthetic fixture data. They do not demonstrate fresh mesh rendering, slicing, or physical printing. The fixture archive has metadata and saved PNGs but no printable mesh. No production API, printer, credential, or downloaded user design was used.

`DEMO_PROJECT=plates` selects the two-filament scenario in `proof/general-sample/serve.mjs`. That server binds to loopback on port 3086 by default. `DEMO_PORT` changes the port. `proof/plate-selection/demo.js` contains the discovered selectors, cursor, captions, and scenario. Discovery used the shared browser; the final recording used `record.mjs` with Playwright after shared-recorder timeouts. `--rehearse` omits video output, and `PLAYWRIGHT_PACKAGE` accepts the path to an external Playwright installation. `DEMO_URL` is restricted to loopback. Raw Playwright recordings go under ignored `data/plate-selection`.

`scripts/create-plate-preview-fixtures.py` regenerates the metadata-only archives under `test/fixtures/plate-previews`. Inspection tests cover valid, missing, malformed, oversized, unsafe, and cross-plate PNG references. Order tests cover independent requirements, subset selection, one source snapshot, duplicate/missing mappings, and recovery after a partial submission without catalog reads. React tests cover selection retention, empty selection, preview payloads, per-plate controls, and continued polling after the first plate is created.
