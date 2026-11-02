# Partner SDK upgrade from npm 0.2.0

This audit compares the actual npm `@printhive/api@0.2.0` tarball with SDK source on main at `558fc36f8b31331137d2353caaefee5737dcaa39`. Main declares 0.3.0; that declaration does not establish an npm release. The sample's package manifest and lockfile still pin 0.2.0. Its development installation previously used a locally packed 0.3.0 build.

## Already available in 0.2.0

Partners do not need a new SDK release to send these existing inputs:

- Multipart `printJobs.create` with a file path or bytes, filename, one plate, typed filaments, optional named printer, release mode and `on_filament_mismatch` set to `wait` or `reject`.
- Existing JSON creation from a Model File.
- Durable caller-supplied idempotency keys and replayable multipart bodies.
- `printJobs.getCreateRequest` and `waitUntilCreated`, including `PrintJobCreateStoppedError` for held, failed or cancelled receipts. A created receipt can retain `job: null` after deletion.
- Printer list/get, partner upload/inspection polling, model lookup and file iteration.
- Typed API/network errors, Retry-After handling, timeouts, cancellation, and ESM/CommonJS/type declarations without runtime dependencies. HTTP uses global `fetch`.

## Additions already merged in SDK source

| Addition                         | What a partner adopts                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preparations.create`            | Canonical `items`, explicit source references, `materialMappings`, selected plates, quantity and `target.printerId`; optional supplied idempotency key and abort signal. Inputs are validated before HTTP, including the 20-item limit.           |
| `preparations.get`               | Read the immutable preparation and per-plate ready/held/failed state.                                                                                                                                                                             |
| `preparations.waitUntilSettled`  | A bounded total polling deadline with cancellation; inspect ready, held and failed outcomes explicitly.                                                                                                                                           |
| `preparations.download`          | Retrieve signed download metadata for a ready plate, then check URL policy, expiry and expected hash before consuming bytes. This is metadata, not automatic arbitrary-URL downloading.                                                           |
| Preparation types and validators | New public input, item, mapping, prepared-plate, download and target-refusal types come from the API contracts. Existing source/model/printer/create signatures remain compatible.                                                                |
| `PrintHiveApiError.reasons`      | Typed target-refusal reasons for `target_not_qualified`. Other errors retain their body and existing fields; this getter does not describe every API failure.                                                                                     |
| Retry change                     | `503 preparation_disabled` stops immediately rather than retrying as a transient outage. Other bounded retry rules remain.                                                                                                                        |
| `filamentCatalog.upsert`         | Sync an organization-owned catalog Material using stable partner external ID, brand, material type, color name/hex and SKU; optional successor metadata. Replays use an encoded external ID as the idempotency header and an immutable JSON body. |
| `filamentCatalog.list/get`       | Read synced organization catalog bindings by filters or Hive UUID. These do not replace the broader global/organization requirement search and do not enable exact-product enforcement on jobs.                                                   |

The catalog types describe Material identity; a source/project filament, physical Material Requirement and slicing profile remain separate concepts. Catalog sync does not expand PETG-only preparation qualification.

## Changes in server behavior to handle

- Create requests remain `preparing` until sliced output processing finishes. A slice marked ready does not by itself authorize admission. Processing failure and timeout are terminal outcomes to display, and manual release remains explicit.
- A created job can be waiting for filament. The create receipt is not a live job snapshot or a promise that materials are loaded. Read the job after creation and keep reading it while waiting.
- A named printer's material mismatch defaults to waiting; explicit `reject` returns a material rejection through the create workflow. Inspect both immediate API errors and a failed asynchronous create receipt without inventing a job.
- Admission and claim use the organization's color threshold. Partners must not reproduce a hard-coded default threshold in the client to decide whether a job can print.
- Claim rechecks current material routes. A spool swap can make a previously eligible job wait again. A queued job or empty waiting-reason list is not physical readiness or successful execution.
- Production still depends on a Host that supports plate selection. `plate_selection_host_update_required` is a capability hold, not a successful E2E result. Verification uses mock printers and no lab Host.

## New release required by this update

1. Add a typed `printJobs.get(jobId, signal?)` method for `GET /v1/print-jobs/{id}`. Validate the response and return the inner job, distinct from the create receipt. Include the canonical job waiting-reason types in the generated snapshot and declarations.
2. Integrate the separate waiting-reason change after it merges. The confirmed response contains only unmet filaments at create and claim, with optional `cause`: `slot_empty`, `missing_material`, `color_distance` or `slot_conflict`. Colors may omit `#`; a physical suggestion is present only when the request supplied `targetSlot`. The unpublished 0.3.1 SDK generates this response and exports `FilamentWaitingReason`. Request inputs do not change.
3. Include all existing 0.3.0 preparation/catalog additions and document the retry change. Export the job snapshot and waiting-reason types, with normal drift/build/type/runtime tests and packed ESM/CommonJS consumer checks.
4. Keep the waiting-reason owner's 0.3.1 version decision and update release notes. The branch alone does not provide the live-job read method; the preview must also include that method. Until publication, use an explicitly identified local workspace or packed build and show its actual version/capabilities in the example.
5. Jerrod approved npm publication from main after the waiting-reason PR merges, and approved the public example repository. Publish only when those conditions hold, verify the registry artifact, update the sample manifest and lockfile to it, and rerun Node 20 and 24 tests against that published package. This does not authorize merging another PR.

Release/cancel remain thin backend HTTP helpers because the SDK has no such methods. Broad Material search likewise remains an existing backend adapter. These are recorded SDK ergonomics gaps, not prerequisites for the named-printer wait/reject path. Publication remains gated on the approved main-branch release conditions; the local preview does not establish an npm release.
