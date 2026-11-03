# Historical job-flow verification

This record predates the published 0.3.2 adoption. Version and publication statements below describe that run. See [the current SDK reference](sdk-upgrade.md) for the committed dependency and search adapter.


The updated example uses a locally packed, unpublished working build of SDK 0.3.0 with `printJobs.get`. Its registry dependency and lockfile remain at npm 0.2.0. The running example keeps its configured real production API destination; no fake API replaces that user service.

## Checks completed

- SDK: 64 tests passed, one existing opt-in test skipped; normal build, schema drift, TypeScript and lint checks passed.
- Sample: all 51 tests passed on Node 24, including durable mismatch policy, historical omitted-policy replay, file binding, explicit placement-hint replay, job reads, deleted jobs and denied live-job reads.
- Simulator: all 32 tests passed, including five new public job-flow SDK transport-contract tests; simulator TypeScript passed. CI now includes both simulator suites.
- Browser rehearsal passed before recording. Desktop 1280 × 900 and phone 390 × 844 covered file extraction, plate selection, four typed requirements, explicit named-printer placement, preview, create receipt polling, live job reads and waiting updates.
- Separate recordings covered immediate HTTP 422 rejection and an asynchronous failed create receipt. Neither case displayed an invented job.

## Local UI evidence

These ignored local files are available in this checkout:

- Desktop job waiting and refresh, 23.64 seconds.
- Phone job waiting and refresh, 23.56 seconds.
- Immediate rejection, 19.16 seconds.
- Asynchronous rejection, 18.92 seconds.

Each recording uses the actual packed SDK and actual sample backend against an owned loopback HTTP contract fixture. The subtitle identifies that fixture. It is not a real API, database, engine or claim proof. The synthetic four-palette archive is a UI fixture, not a qualified slicing fixture. Fixture job-state changes establish UI refresh behavior, not execution or claim success.

The full final exported durations were decoded and visually reviewed as 5 fps filmstrips, including each final segment. The rejection captures were repeated to bring their errors visibly into frame. No browser errors, cross-origin request violations or horizontal overflow were observed. All owned fixture servers and temporary order stores were removed after the run.

The one-row waiting response in the earlier recording is fixture-supplied data. The consumer now supports the confirmed unmet-only/cause response, including bare hex colors, but those recordings do not yet demonstrate the added cause explanations. New contract tests exercise them; refreshed browser evidence and real server proof remain required.

## Review and remaining work

Independent Sol reviews approved the SDK and consumer behavior. One existing limitation was documented: a denied live-job read stops automatic job polling, while a denied create-receipt read still follows the existing retry path.

The normal Hive hook checks the simulator and SDK commit. This standalone repository has no configured commit hook. Its approved public repository and origin now exist, but no sample source has been pushed. npm publication is approved only from main after the waiting-reason change merges; no npm release or merge has occurred.

The final contract is confirmed: only unmet rows, optional `cause`, and an optional target suggestion for an explicit request target. The consumer supports it now. SDK 0.3.1 remains unpublished; preview it through the local workspace and include the separate live-job read method. Publication must wait for the waiting-reason PR to merge, then use main and run both Node versions against the published package. Refresh affected UI evidence before claiming the new cause presentation was visually verified.

Docker did not answer the bounded local health check, so real isolated API/database/Cloud Slice and mock claim proof remains pending. See [the E2E plan](e2e-plan.md) for the three-of-four-loaded and claim-recheck scenarios. No real printer, live farm or lab Host was contacted, and no production order was submitted.

## Confirmed waiting-reason contract preview

The updated consumer was checked against unpublished SDK 0.3.1 in a local workspace. The integration preview uses the supplied waiting-reason head `89dd734fd4376111d89f1a233261effd14c280a9` plus the separate live-job read method. It is not a published package or a claim that those PRs are merged. The registry dependency and lockfile remain unchanged until publication.

All 54 sample tests passed on Node 20.20.2 and Node 24.18.0; 33 simulator tests and its TypeScript check passed against the same workspace. The preview SDK passed normal build/drift/type checks and 64 tests, with one existing opt-in skip. An independent Sol round approved the final consumer and workspace changes; its documentation nit about the now-created public origin was corrected.

New local recordings in ignored `data/waiting-shape-proof` cover desktop 1280 × 900 for 32.60 seconds and phone 390 × 844 for 31.28 seconds. Both full exported durations were decoded and reviewed as 5 fps filmstrips, including their final segments. They show only returned Source Slot 3, a bare-hex blue color rendered as a swatch, an empty-slot cause and explicit API target, unchanged raw JSON, and a fixture-supplied recheck snapshot for Source Slot 0 with a color-distance cause and no physical target. All four causes and missing/unknown-cause fallbacks have focused tests. No browser errors, cross-origin violations or horizontal overflow occurred.

These recordings use an owned HTTP fixture through the actual SDK and backend. They do not prove real API/database/engine/claim behavior or production support. No source has been pushed to the approved public sample repository; the final registry-package tests on both Node versions remain pending.

The latest coordination notes corrected two operator instructions. Explicit slot conflicts now request a different assignment; conflicts without a target request another matching spool. Uncertain material readings request a recheck, even if optional material fields are present. The `color_distance` explanation asks the operator to check material or color because the upstream evaluator can currently conflate those failures. Two focused regressions were observed failing before those fixes.

## Corrected operator guidance

The final focused recordings in ignored `data/waiting-guidance-proof` supersede the earlier cause-wording capture for guidance. Desktop is 25.48 seconds and phone is 25.40 seconds. Rehearsal passed first; both full exported durations were decoded and reviewed as 5 fps filmstrips. They show the explicit conflict/assignment remedy, unhinted conflict/additional-spool remedy, uncertain-reading recheck, advisory material-or-color mismatch and cleared waiting state. Each frame remains labeled HTTP fixture. No new real API/database/engine or claim proof is implied.

All 56 sample tests passed on both Node 20.20.2 and Node 24.18.0 against the unpublished 0.3.1 workspace. The targeted guidance regressions failed before the fix and passed afterward. A second independent Sol round approved the correction. Docker's normal and supported forced restarts did not restore the engine; its startup and local diagnostics timed out. No data reset or diagnostics upload was performed. The registry-package publication tests remain pending the main-branch release.

## React, Vite and shadcn migration

The sample frontend now uses React and TypeScript, built by Vite, with official shadcn Radix Nova components and PrintHive theme tokens. The Node backend retains its SDK credentials, API adapters and durable order store. Production serving exposes only the compiled frontend assets. Development serves `client/` with an explicit file allowlist; a red/green HTTP regression proves saved orders/uploads and backend-only modules are refused.

Local migration verification passed on Node 20.20.2 and Node 24.18.0: frontend build/typecheck, 57 backend/security tests and three React workflow tests. These runs use the existing local SDK preview, not the eventual npm registry artifact.

Browser discovery and rehearsal preceded five recorded scenarios through the built React app, actual SDK and Node backend against an owned HTTP fixture. The entire exported recordings were reviewed using five-frame-per-second filmstrips, including final states:

- Desktop, 63.50 seconds: uploaded three-plate project, plate 2, four explicit source requirements, physical hint for source 3, preview, manual hold/release, live unmet-only waiting reason and refreshed completion.
- Phone, 44.75 seconds at 390 × 844 CSS pixels: the same selected-plate/mapping/manual-release flow and readable source-3 waiting instruction.
- Catalog, 7.27 seconds: validation preview, explicit SDK upsert, list and read of the stable catalog identity.
- Immediate rejection, 5.19 seconds: HTTP 422 stays an error without a created job.
- Asynchronous rejection, 5.62 seconds: the failed receipt retains the nested admission error and does not invent a job.

Recordings and sanitized HTTP-fixture evidence are retained locally under ignored `data/react-migration-proof/`. They demonstrate migration behavior, not real slicing, persistence, claim or physical-print qualification. The separately approved main-849 real-stack proof gates npm publication and the public source push. No production submission, release or printer action was used to verify this migration.

## Published SDK 0.3.2 verification

The release proof subsequently passed against unchanged main source `84967559f80b29de10d3d2b4355091204682bf23`, using the actual packed SDK, local API, real database/Storage, Cloud Slice, Bambu engine and output worker. Selected plate 2 produced a queued job with four PETG requirements. Three SDK job polls showed only Source Slot 3 missing. A normal mock claim returned no job until the fourth filament/loadout and fresh telemetry were supplied, then claimed that same job. No Host process, G-code sender or physical printer was involved.

The published npm 0.3.2 tarball is byte-identical to the tested proof tarball. The sample manifest and lockfile now pin that registry release. A clean registry install passed build/typechecks, 57 backend/security tests, three React workflow tests and ESM/CommonJS imports on both Node 20.20.2 and Node 24.18.0. The local preview recordings above remain UI evidence for the same behavior, distinct from this real-stack proof.

See [release proof](../proof/release-0.3.2/README.md), [registry identity](../proof/release-0.3.2/registry.json) and [registry test results](../proof/release-0.3.2/registry-tests.json). The real-stack run did not separately exercise reject mode or physical printing. Stock-profile expansion beyond the qualified plain PETG P1S target remains separate work.
