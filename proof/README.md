# Local proof

These transcripts use the npm registry package `@printhive/api@0.2.0`. The package lock records its tarball and integrity hash. `npm-install.json` records `npm ls`.

The isolated stack used source revision `a7d7a317f163`, a separate Supabase project on ports 57320–57329, Redis on 57379, API on 13030, and Cloud Slice on 57381. The shared Supabase stack remained untouched. The gateway used the qualified real engine through local Docker, serialized to one engine container at a time with 2 CPUs and 3 GiB memory. No production API, Fly machine, printer connection, or motion was involved. The mock printer and host exist only as database fixtures.

The public runner expects an already provisioned owned stack. Private stack provisioning files and credentials are deliberately outside this repository. Reproduce with `npm ci`, supply an owned loopback API and mock printer, then run `npm run proof`.

## Default-timing failure

`without-processing-worker.log` records the initial admission failure. `default-recovery.log` reproduces it with the normal Model File Processing Worker running and the default 30-second recovery interval. HTTP 202 progresses through `preparing` to permanent `failed` with `model_file_not_ready`, before a job exists. This is an API timing defect, not a successful job creation result. The workflow treats a transient output lifecycle state as a permanent refusal. No API or SDK patch was applied.

`host-capability-refusal.log` records a later run with the supported recovery interval shortened to 100 ms. It gets past model-file processing but correctly refuses an incomplete mock host fixture with `plate_selection_host_update_required`. It also proves cancellation before admission.

The final run adds a mock host that advertises chosen-plate capability. Its assignment is suspended, and no host process or physical printer is present. The recovery interval remains 100 ms. This timing adjustment is a verification condition, not a fix for the default-timing defect.

## Tests

`node20-tests.log` records nine passing tests on Node 20.20.2. These tests do not require the local Hive stack. They cover application persistence and state handling, including a multipart request through the installed SDK with a controlled HTTP response.

## Publication limits

Do not claim reliable end-to-end behavior under default processing timing until the API race is resolved. The sample README contains no links to private documentation. The published dependency's own README contains relative `../../docs` links into its private source repository, an obsolete pre-release installation instruction, and a private repository URL. Those upstream documentation problems are outside this sample.

The sample's local store supports one writer process. It is not a production database, and the loopback backend has no customer authentication. Failed transcripts remain alongside successful evidence so the verification conditions stay visible.

## Final result

`local-e2e.log` ends with `result: PASS`. It exercises the actual HTTP backend for the automatic order, including duplicate `POST /orders` and `GET /orders`, then the shared order implementation for the other scenarios. The installed SDK supplies creation and polling throughout.

| Scenario | Request ID | Observed states | Result |
| --- | --- | --- | --- |
| HTTP order, pinned mock | `efc3a97b-4742-4626-8ac9-ab9595f84efb` | `preparing`, `created` | queued job `1` |
| Manual authorization | `58a402fb-7280-4e04-a48c-d451c9d0073d` | `preparing`, `held`, release, `preparing`, `created` | queued job `2` |
| Cancel before admission | `19c4df67-9a84-45f9-87c7-81d574d5bf69` | `preparing`, cancel, `cancelled` | no job |
| Printer omitted | `23d00cbe-9963-4f21-af01-1ff326fce27a` | `preparing`, `created` | queued job `3`, printer null |

Jobs `1` and `2` name database-only mock printer `402d1ec1-9db3-4df7-9dac-21f560d782c0`. The manual hold exposes `requiredActions: [{"code":"manual_release_required"}]`. The optional-printer job waits for Smart Queue assignment. This proof does not claim a printer claim or physical print completion.

Teardown exited successfully. No listeners remained on the owned API, Supabase, Redis, or slicing ports, and no owned engine, Redis, or Supabase containers remained. The shared Supabase containers stayed running. `node24-tests.log` records the same nine tests passing on Node 24.18.0.

The Model the Domain principle shaped the order store: each selected plate owns one durable idempotency key and one creation request ID.

## Browser UI

[UI proof](ui/README.md) uses a separate loopback HTTP stub with a dummy key. It exercises the installed SDK through the example server and browser. Its screenshots and video cover automatic creation, manual release, and cancellation. This stub proof does not change the real API timing findings above.
