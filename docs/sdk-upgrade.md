# SDK calls used by this sample

The manifest and lockfile pin the published npm registry package `@printhive/api@0.4.1`. The Node backend owns every SDK call. The browser receives no API credential. No local SDK build or HTTP search fallback is required.

| UI operation | Backend call | Result |
| --- | --- | --- |
| Inspect a 3MF | Local metadata inspection | Filename, SHA-256, plates, previews, and source slots |
| Search filaments | `client.filaments.search({ query, limit, offset })` | Catalog rows with `filamentId` and `acceptedByCreate` |
| Search printers | `client.printers.search({ query, limit, offset })` | Organization printer IDs, names, models, and pagination |
| Preview selected plates | Local mapping validation | Source slots, catalog IDs, and optional placement hints |
| Submit selected plates | `client.printJobs.create` once per plate | Hive resolves catalog material and color; separate creation request IDs |
| Read preparation | `client.printJobs.getCreateRequest(requestId)` | Preparing, held, failed, cancelled, or created receipt |
| Release or cancel | Server-only HTTP helper | Updated receipt; the SDK has no helper |
| Follow a created job | `client.printJobs.get(jobId)` | Live job state and unmet filament requirements |
| CLI wait | `client.printJobs.waitUntilCreated(requestId)` | Created receipt or `PrintJobCreateStoppedError` |
| Sync catalog | `client.filamentCatalog.upsert`, `.list`, `.get` | Organization catalog bindings |

## Search contract

SDK 0.4.1 uses `GET /v1/printers/search` and `GET /v1/filaments/search`. Both methods accept `{ query, limit?, offset?, signal? }` and use the SDK's authenticated transport, retries, and response validation. The sample adapter adds only input bounds and UI field projection. It does not implement matching or ranking.

Example queries are `black PETG`, `bambu red`, and `Boo P1S`. Filament results retain the API's `hasMore` and `matchMode`. A broadened response is labeled in the UI. Printer pagination uses the returned total.

`src/catalog.mjs` projects search results for the UI. Mapped requests retain the selected `filamentId` without an organization-only read through `filamentCatalog.get`. That resource remains available for organization catalog sync. UUID search queries go through `filaments.search` like other text; the sample makes no guarantee that text search finds an ID. There is no `/v1/materials` HTTP lookup, legacy search route, or missing-method fallback.

## Filament creation eligibility

`acceptedByCreate` is the API's catalog-admission flag. The UI enables results with a true flag and disables results with a false flag. A true flag does not establish file, printer, material-loading, readiness, or dispatch eligibility.

Creation accepts synced organization catalog filaments and eligible global catalog filaments. A global filament needs a material and one unambiguous color. The organization's `materials.global_filaments_enabled` setting must be enabled; a missing setting defaults to enabled. With globals disabled, search excludes global rows and creation rejects their IDs. Unsynced organization rows, merge tombstones, and rows without usable material or color remain ineligible.

New mapped requests include `sourceSlot`, `filamentId`, and an optional per-plate `targetSlot`. Hive resolves material and color and saves the admitted catalog snapshot. The sample stores the submitted requirements and keys before sending. An unchanged retry retains those fields. Existing saved requests keep their original payload shape, including older explicit material and color snapshots and requests without `filamentId`.

If a caller supplies explicit material or color with a catalog ID, Hive checks that the values agree. Material comparison ignores case, but `PLA-S` and `PLA` remain different values. Catalog identity does not add an exact-product constraint to material and color matching.

## Catalog creation errors

The sample preserves these creation errors without exposing upstream response bodies. A preview validates local mapping structure; Hive checks current catalog admission during creation.

| HTTP status | API code | Meaning |
| --- | --- | --- |
| 422 | `catalog_filament_not_found` | The ID is unknown, foreign, unavailable, or global while globals are disabled. |
| 422 | `invalid_catalog_filament` | The catalog row has no usable material or single color. |
| 422 | `filament_catalog_conflict` | An explicit material or color contradicts the catalog row. |
| 503 | `catalog_store_failed` | Hive cannot read the catalog or organization settings. A failed settings read never defaults to enabled. |

The SDK retries eligible 503 failures with the same idempotency key. If retries are exhausted, the sample returns HTTP 503 with `code: "catalog_store_failed"` and `upstreamStatus: 503`. The saved order remains available for an unchanged retry.

## Shared source assignments

The browser can copy a material assignment to currently selected plates with the same source slot and normalized original material/color. Display names do not define identity. Different source slots remain independent even when their colors match. The copy never changes inclusion, confirms usage, or copies a physical placement hint. A later individual choice changes only that plate. The outgoing `plateMappings` still contains one explicit group per plate.
