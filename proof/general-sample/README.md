# General sample UI verification

The recordings use the built React app, the real installed SDK, and the Node backend against `serve.mjs`, an owned loopback HTTP fixture. The fixture has no slicing engine, database, printer connection, or production credentials. It accepts only the bundled `cube.3mf` filename.

| Recording | Installed SDK | Visible behavior |
| --- | --- | --- |
| [Desktop](registry-desktop.mp4) | Published 0.3.2 | Known plate-data editor, labeled legacy filament lookup, unavailable printer search, direct printer ID, request preview, preparing, manual hold, release, created receipt, live job and filament-waiting details, neutral catalog panel |
| [Mobile](search-sdk-mobile.mp4) | Unpublished build of #5039 at `23039ac3` | SDK provenance banner, plate-data editor, SDK filament search for `black PETG`, SDK printer search for `Boo P1S`, selected printer UUID, request preview, manual hold, cancellation, neutral catalog panel |

Both paths passed rehearsal with zero page errors and no horizontal overflow at 1280 × 900 and 390 × 844. The final encoded files received full playback review and visual inspection across their complete durations. The videos prove rendering and protocol use with fixture responses. They do not prove real search relevance, cloud slicing, job persistence in Hive, a claim recheck, or physical printing.

The local search package came from a detached scratch worktree of the PR. Its generator consumed the PR's committed OpenAPI snapshot, then tsup built the unchanged SDK source and declarations. `npm run sdk:local` installed the packed archive without changing the manifest or lockfile. The scratch worktree was removed and `npm ci` restored 0.3.2.

The PR head's package metadata says 0.3.0 and lacks the later `printJobs.get` helper. The mobile cancellation path does not use that helper. The desktop recording separately exercises the published 0.3.2 live-job read.

`serve.mjs` defaults to port 3086; `DEMO_PORT` selects another loopback port. `record.mjs` accepts `--rehearse`, `--search-sdk`, `--desktop`, and `--mobile`. `PLAYWRIGHT_PACKAGE` can point to an external Playwright installation. `DEMO_URL` selects the loopback fixture URL. `demo.js` contains the discovered selectors, cursor, captions, and timed actions.
