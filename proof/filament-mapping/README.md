# Production catalog and plate mapping proof

This proof drives the example at `http://127.0.0.1:3077` with the real production API and PHJ server credential. The runner never reads the credential. Browser traffic stays on the example origin. The permitted POSTs are local project extraction and `/orders/preview`. Extraction reads local metadata; the preview performs authenticated catalog GET requests. Order creation, release, cancellation, and direct browser calls to production are blocked.

Run with the example already running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/filament-mapping/run.mjs
```

The three-plate project is a small synthetic Bambu project from the Hive simulator fixture builder. Its known source-slot pairs are `[0, 1]`, `[1, 2]`, and `[0, 2]`. `three-plate.json` represents the plate data your application supplies after processing that project. The project is used only in the browser and local preview; it is not submitted to Hive.

The proof covers:

- Production destination and live SKU/UUID catalog lookups, pagination, and empty results.
- Separate source data and requested Hive material/color characteristics.
- Plate 3 retaining source slots 0 and 2, independent mappings when switching plates, and restoring the original plate's choices.
- Resetting choices on file changes and rejecting duplicate source slots.
- Exact outgoing SDK fields, with no catalog IDs/SKUs or physical target slot added.
- A 390-pixel mobile layout without horizontal overflow.

`results.json` contains the observed requests and assertions. `tests.log` records 23 passing Node 24 tests, including lost-response recovery after a catalog rename or outage. The independent Sol review approved the replay fix in its second round.

`desktop.webm`, `mobile.webm`, and the screenshots are local proof artifacts. The videos show the source mapping and preview workflow, including the end of the request preview. They do not prove new job admission, inspection-hold resolution, physical printer readiness, or execution. No order was created by this proof. Media are excluded from source control.

The older `proof/ui` fixture-backed recordings are historical and do not verify this production-connected mapping UI.

The final exports were reviewed frame by frame: all 109 desktop frames and 30 mobile frames. The first capture cut off the preview, so capture was corrected to scroll it fully into view. Full-page screenshot capture briefly resized the recorded viewport; those capture-only frames were removed. All retained export frames were checked pixel-identical to the inspected frames. Future runs capture viewport screenshots while recording to avoid that resize.

The automatic uploaded-file path is covered by [the plate extraction proof](../plate-extraction/README.md). This runner also retains coverage for Advanced partner-supplied data.
