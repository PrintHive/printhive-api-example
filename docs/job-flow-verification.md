# Public job-flow verification

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

The one-row waiting response is fixture-supplied data that the UI preserves. It does not prove the pending server change lists only unmet filaments, and no final cause-field behavior is claimed.

## Review and remaining work

Independent Sol reviews approved the SDK and consumer behavior. One existing limitation was documented: a denied live-job read stops automatic job polling, while a denied create-receipt read still follows the existing retry path.

The normal Hive hook checks the simulator and SDK commit. This standalone repository has no configured commit hook or remote. No hook bypass, npm publication, public sample remote or merge is part of this update.

Final unmet-only waiting reasons, cause handling and the next SDK release version remain dependent on the separate delegate PR. Rebuild and repack after that contract lands, update both consumers and refresh the affected evidence.

Docker did not answer the bounded local health check, so real isolated API/database/Cloud Slice and mock claim proof remains pending. See [the E2E plan](e2e-plan.md) for the three-of-four-loaded and claim-recheck scenarios. No real printer, live farm or lab Host was contacted, and no production order was submitted.
