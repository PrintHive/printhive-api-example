# Partner SDK upgrade from npm 0.2.0

This audit compares npm SDK 0.2.0 with published 0.3.2, now pinned by this sample. The release includes preparation/catalog support, unmet-only waiting reasons and live job reads. Registry-install checks on Node 20 and 24 are recorded with the real-stack proof under `proof/release-0.3.2/`.

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
| `preparations.downloadInfo`      | Retrieve signed download metadata for a ready plate, then check URL policy, expiry and expected hash before consuming bytes. This is metadata, not automatic arbitrary-URL downloading.                                                           |
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

## Adopt SDK 0.3.2

1. Install the exact registry release with `npm ci` from this sample.
2. Use `printJobs.get(jobId, signal?)` after creation to read live status. Its return value is the inner job, distinct from the immutable creation receipt.
3. Render only the returned unmet rows. `FilamentWaitingReason` includes optional `cause`: `slot_empty`, `missing_material`, `color_distance` or `slot_conflict`. Colors may omit `#`. Physical suggestions require an explicit request `targetSlot`.
4. Keep causes advisory: a material-type mismatch can still report `color_distance`. Recheck readings for `material_route_changed`; an explicit slot conflict needs an assignment change, while an unhinted conflict may need another matching spool.
5. Preserve existing server qualification boundaries. Catalog availability does not qualify a slicing profile, printer, nozzle or build surface.

Release/cancel remain thin backend HTTP helpers because this SDK has no such methods. Broad Material requirement search remains a backend read adapter, separate from SDK catalog sync. These limitations are not hidden by fallback SDK calls. The real-stack proof covers the plain PETG P1S 0.4 path; it does not establish support for every Bambu material profile or physical print quality.
