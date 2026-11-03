# Shared material mapping verification

[Desktop recording](desktop.mp4) and [mobile recording](mobile.mp4) show the built React app and Node backend using published SDK 0.4.0 with an owned loopback API fixture. CSS viewports are 1280 by 900 and 390 by 844. The final exported videos received complete playback and visual review before publication.

The scenario uses a generated metadata-only project. Plates 2 and 7 share source slot 0. Plate 9 uses slot 1 with the same original material and color, so it must not inherit slot 0's assignment.

Both paths show these behaviors:

- SDK searches for `black PETG`, `bambu red`, and `Boo P1S`.
- An organization catalog row is selectable; a global row with `acceptedByCreate: false` remains visible and disabled.
- A material can be assigned before source usage is confirmed. Submission remains disabled until each selected plate's usage is confirmed.
- Bulk apply copies the material to selected plates with the same original source identity. It never copies physical placement or approves usage.
- Reconfirming usage keeps assignments. A blue override on plate 7 leaves plate 2 red.
- Plate 9 stays unmapped until assigned explicitly despite its identical original color.
- The resolved preview carries source slots and catalog `filamentId` values for red on plate 2, blue on plate 7, and red on plate 9. Submission becomes enabled.

This is UI and protocol proof with synthetic API responses, not real catalog relevance, slicing, or physical printing. No production API, real printer, production credential, user design, or port 3077 was used. Global catalog creation remains unsupported by the sample's SDK 0.4.0 flow; pending 0.4.1 work is described in the SDK reference.

`DEMO_PROJECT=shared` selects this scenario in `proof/general-sample/serve.mjs`, which binds to loopback on port 3086. `DEMO_PORT` changes that port. `demo.js` contains the discovered selectors, cursor, captions, and assertions used by the shared browser. `record.mjs` reproduces the scenario with Playwright. Its `--rehearse` option skips video output; `PLAYWRIGHT_PACKAGE` can identify an external Playwright installation. Raw recordings stay under ignored `data/material-mapping`.

`scripts/create-shared-material-fixture.py` regenerates `shared.3mf`. It contains only synthetic metadata and saved preview PNGs, not a printable model. The fixture deliberately gives two source indices the same attributes to detect color-only grouping.

The original failing UI reproduction cleared a mapped material on repeated confirmation. Three targeted tests reproduced the failures before implementation. Later guard tests cover late confirmation, different source attributes, project changes, independent overrides, and placement isolation. The same UI reconfirmation now retains the mapping and keeps a fully configured order enabled. Backend tests exercise the real SDK with mock fetch, new search routes, eligibility, catalog identity, multipart `filamentId` wiring, and unchanged replay of pre-upgrade records.
