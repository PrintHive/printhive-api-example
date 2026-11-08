# Selected plates and release modes

This proof uses the published `@printhive/api@0.6.0`, the built React app, and the real Node backend with a loopback HTTP fake. It never contacts production, reads a real key, invokes a slicing engine, or connects to a printer.

The metadata-only `shared.3mf` fixture is derived from the repository's synthetic saved-preview fixture. Plates 2 and 7 share Source Slot 0. Plate 7 also uses slot 1 and has no saved thumbnail. Plate 9 uses slot 2 with the same material and color as slot 1. The fake fails plate 9 so the progress view shows an API code and reason.

## Reproduce

```sh
npm ci
npm run verify
npm run build
node proof/selected-plates/serve.mjs
```

Open <http://127.0.0.1:3086>. This runner overrides the key with a dummy value, removes the key-file variable, and uses only its own loopback fake. It does not use port 3077. All source and order storage is temporary.

The browser script discovers native controls in the running app and asserts each required state. For automated rehearsal and recording, in another terminal:

```sh
npx playwright install chromium
node proof/selected-plates/record.mjs --rehearse
node proof/selected-plates/record.mjs
```

The recorder aborts browser requests outside the owned loopback app. Raw recordings go to ignored `data/selected-plates/`. `demo.js` also runs through T3's shared browser. Captions and cursor movement identify each step.

## Audit and adaptations

Before this change, plate previews, sparse plate numbers, independent per-plate mappings, searches, and durable multipart retries already existed. The missing combined mapping view made the multi-plate path repetitive. The backend also lacked local browser protection and key-file input.

The implementation adapts the selected-slot union from `toProjectFilaments` in Hive PR #5187, per-plate request filtering from `slicePlan`, and the ledger's progress rollup, independent failures, and release eligibility. PR #5190 informed the combined project flow. Existing sample components and the per-plate override editor remain in place. Production calls use only published SDK APIs.

PR #5185 merged on 2026-11-08. Hive accepts JSON creation with `source_version_id` at `POST /v1/print-jobs/create`. This sample keeps multipart creation; implementing source-version creation and organization-wide recovered history remains a follow-up. The sample retains its local store and same-order retry behavior. Full painted/support usage resolution remains outside the local metadata reader. Unknown usage requires operator-supplied source slots or known project data and never silently becomes an all-palette mapping.

## Coverage and limits

The desktop paths cover upload, all plate previews and a missing-preview placeholder, inclusion, shared Source Slot mapping with color swatches, `bambu red`, `black PETG`, printer search for `Boo P1S`, Smart Queue, manual release, cancel, automatic confirmation, and per-plate slicing, holds, queued jobs, and failures. The manual desktop and mobile paths also show upload-time progress, lineage-hold release, exact engine-setting approval, reload recovery, and the explicit **New order** action. Automatic desktop shows the printer name, model and ID suffix, clears that confirmation when Smart Queue is chosen, then requires a new confirmation for Smart Queue.

Backend tests cover the session handshake, Host and Origin refusals, fetch metadata, file-over-env key precedence with dummy temporary files, same-key retries, independent failed sends and polls, and published SDK multipart contracts. React tests cover the selected-slot union, per-plate overrides, accepting or declining automatic confirmation, invalidating stale confirmations, UUID validation, button-only submission, upload-time polling, reload recovery, unload protection, terminal polling, and session renewal after restart.

Fake results prove UI and transport behavior. Real production search relevance, cloud slicing, API timing, loaded-material readiness, farm distribution, printer dispatch, and physical printing remain unverified. Jerrod's production key file was not read or tested.

## Submitted recordings

- [Manual desktop](manual-desktop.mp4), 1280 × 900.
- [Automatic Smart Queue desktop](automatic-desktop.mp4), 1280 × 900.
- [Manual mobile](manual-mobile.mp4), 390 × 844.

The final encoded exports received complete browser playback from the first frame through the last, plus visual review of their timelines. Required controls, confirmation, and final outcomes are visible. The refreshed exports shorten only static pauses longer than six seconds, keeping four seconds for each such state. A first capture stopped at the browser tool's 15-second evaluation timeout and was discarded. Final captures run the scenario asynchronously and stop only after its assertions settle.

[Node 20 backend](node20-tests.txt) and [Node 24 backend](node24-tests.txt) record 90 passing tests each. [Node 20 React](node20-ui.txt) and [Node 24 React](node24-ui.txt) record 29 passing tests each. TypeScript checks passed on both Node versions. The full `npm run verify` also passed on the host runtime. The dev proxy handshake was exercised with a fake backend and is covered by the backend suite.

The Model the Domain principle shaped the source-slot groups and per-plate progress rows. Prove It Works shaped the HTTP fake, browser rehearsals, and exported-video review.
